/**
 * downloader.js — Real file download manager
 *
 * Handles streaming downloads from direct .mp4 URLs with:
 *  - Progress reporting (percent, speed, downloaded, total)
 *  - Pause / Resume / Cancel per download ID
 *  - Persistent state in userData/downloads_state.json
 *  - Max 2 concurrent downloads (queue the rest)
 */

'use strict';

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { URL } = require('url');

const MAX_CONCURRENT = 2;

// In-memory state
const _queue   = [];  // { id, ... } waiting to start
const _active  = {};  // id → { req, writeStream, destPath, paused, ... }
const _done    = {};  // id → { status:'done'|'cancelled'|'error', ... }

let _stateFile = null;
let _progressCb = null; // (id, progressObj) → void
let _log = (msg) => console.log('[downloader]', msg);

// ─── init ─────────────────────────────────────────────────────────────────────
function init(userDataPath, progressCallback) {
  _stateFile  = path.join(userDataPath, 'downloads_state.json');
  _progressCb = progressCallback;
  _loadState();
}

function setLogger(fn) { _log = fn; }

// ─── state persistence ────────────────────────────────────────────────────────
function _loadState() {
  try {
    if (_stateFile && fs.existsSync(_stateFile)) {
      const saved = JSON.parse(fs.readFileSync(_stateFile, 'utf8'));
      // Re-queue incomplete downloads as paused so user can resume
      (saved.queue || []).forEach(item => {
        item.status = 'paused';
        _queue.push(item);
      });
    }
  } catch (e) {
    _log(`Failed to load state: ${e.message}`);
  }
}

function _saveState() {
  if (!_stateFile) return;
  try {
    const data = {
      queue: _queue.map(q => ({ ...q }))
    };
    fs.writeFileSync(_stateFile, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    _log(`Failed to save state: ${e.message}`);
  }
}

// ─── progress helper ──────────────────────────────────────────────────────────
function _emit(id, obj) {
  if (_progressCb) _progressCb(id, obj);
}

// ─── core download ────────────────────────────────────────────────────────────
function _startOne(item) {
  const { id, directUrl, referer, destPath, animeTitle, episodeNumber, quality } = item;

  _log(`Starting download ${id}: EP${episodeNumber} of "${animeTitle}" → ${destPath}`);

  // Ensure directory exists
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Check for existing partial file (resume support)
  let startByte = 0;
  if (fs.existsSync(destPath)) {
    startByte = fs.statSync(destPath).size;
    _log(`Resuming from byte ${startByte}`);
  }

  const urlObj = new URL(directUrl);
  const client = urlObj.protocol === 'https:' ? https : http;

  const reqHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    'Referer': referer || directUrl,
    'Accept': '*/*',
  };
  if (startByte > 0) reqHeaders['Range'] = `bytes=${startByte}-`;

  const reqOpts = {
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    headers: reqHeaders
  };

  const req = client.request(reqOpts, (res) => {
    // Follow single redirect
    if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
      const location = res.headers.location;
      if (location) {
        res.resume(); // drain
        const redirectItem = { ...item, directUrl: location };
        _log(`Redirected to: ${location}`);
        _startOne(redirectItem);
        return;
      }
    }

    if (res.statusCode !== 200 && res.statusCode !== 206) {
      _emit(id, { status: 'error', message: `HTTP ${res.statusCode}` });
      _log(`Download ${id} failed: HTTP ${res.statusCode}`);
      delete _active[id];
      _processQueue();
      return;
    }

    const totalFromHeader = parseInt(res.headers['content-length'] || '0', 10);
    const total = totalFromHeader + startByte;

    let downloaded = startByte;
    let lastTime   = Date.now();
    let lastBytes  = startByte;

    const writeStream = fs.createWriteStream(destPath, { flags: startByte > 0 ? 'a' : 'w' });

    // Track in active map so we can pause/cancel
    if (!_active[id]) {
      _log(`Download ${id} was cancelled before start`);
      res.resume();
      return;
    }
    _active[id].req         = req;
    _active[id].writeStream = writeStream;
    _active[id].total       = total;
    _active[id].downloaded  = downloaded;

    res.on('data', (chunk) => {
      // Pause support — if flagged, destroy and leave partial file
      if (_active[id] && _active[id].paused) {
        req.destroy();
        writeStream.end();
        _emit(id, { status: 'paused', downloaded, total, percent: total ? Math.round(downloaded / total * 100) : 0 });
        return;
      }

      writeStream.write(chunk);
      downloaded += chunk.length;
      if (_active[id]) _active[id].downloaded = downloaded;

      // Throttle progress updates to ~4/s
      const now = Date.now();
      if (now - lastTime >= 250) {
        const elapsed  = (now - lastTime) / 1000;
        const bytes    = downloaded - lastBytes;
        const speed    = elapsed > 0 ? bytes / elapsed : 0;
        const percent  = total > 0 ? Math.round(downloaded / total * 100) : 0;
        lastTime  = now;
        lastBytes = downloaded;
        _emit(id, { status: 'downloading', percent, downloaded, total, speed });
      }
    });

    res.on('end', () => {
      writeStream.end();
      if (_active[id] && !_active[id].paused) {
        _emit(id, { status: 'done', percent: 100, downloaded, total });
        _log(`Download ${id} complete: ${destPath}`);
        _done[id] = { status: 'done', destPath };
        delete _active[id];
        _removeFromQueue(id);
        _saveState();
        _processQueue();
      }
    });

    res.on('error', (e) => {
      writeStream.end();
      _emit(id, { status: 'error', message: e.message });
      _log(`Download ${id} stream error: ${e.message}`);
      delete _active[id];
      _processQueue();
    });
  });

  req.on('error', (e) => {
    _emit(id, { status: 'error', message: e.message });
    _log(`Download ${id} request error: ${e.message}`);
    delete _active[id];
    _processQueue();
  });

  _active[id] = { req, writeStream: null, destPath, paused: false, total: 0, downloaded: 0, animeTitle, episodeNumber, quality };
  req.end();
}

// ─── queue management ─────────────────────────────────────────────────────────
function _processQueue() {
  const activeCount = Object.keys(_active).length;
  if (activeCount >= MAX_CONCURRENT) return;

  const next = _queue.find(q => q.status === 'queued');
  if (!next) return;

  next.status = 'active';
  _startOne(next);
}

function _removeFromQueue(id) {
  const idx = _queue.findIndex(q => q.id === id);
  if (idx !== -1) _queue.splice(idx, 1);
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Enqueue a download.
 * @param {string} id          Unique download ID
 * @param {string} directUrl   Direct .mp4 URL
 * @param {string} referer     Referer for the request
 * @param {string} destPath    Absolute path to save file
 * @param {string} animeTitle
 * @param {number} episodeNumber
 * @param {string} quality     e.g. '720p'
 */
function startDownload(id, directUrl, referer, destPath, animeTitle, episodeNumber, quality) {
  if (_active[id]) {
    _log(`Download ${id} already active`);
    return;
  }

  const item = { id, directUrl, referer, destPath, animeTitle, episodeNumber, quality, status: 'queued' };
  _queue.push(item);
  _saveState();
  _emit(id, { status: 'queued', percent: 0, downloaded: 0, total: 0, speed: 0 });
  _processQueue();
}

function pauseDownload(id) {
  if (_active[id]) {
    _active[id].paused = true;
    _log(`Pausing download ${id}`);
    // The data handler will notice the flag and destroy the request
  }
  // Also mark in queue
  const qi = _queue.find(q => q.id === id);
  if (qi) qi.status = 'paused';
}

function resumeDownload(id) {
  const qi = _queue.find(q => q.id === id);
  if (qi) {
    qi.status = 'queued';
    // Re-init active slot so _startOne doesn't bail
    if (!_active[id]) {
      _processQueue();
    }
  }
}

function cancelDownload(id) {
  _log(`Cancelling download ${id}`);
  if (_active[id]) {
    const { req, writeStream, destPath } = _active[id];
    if (req) try { req.destroy(); } catch (_) {}
    if (writeStream) try { writeStream.destroy(); } catch (_) {}
    // Delete partial file
    try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (_) {}
    delete _active[id];
  }
  _removeFromQueue(id);
  _done[id] = { status: 'cancelled' };
  _saveState();
  _emit(id, { status: 'cancelled' });
  _processQueue();
}

/**
 * Get current state of all downloads (active + queued + recently done)
 */
function getAllDownloads() {
  const result = [];

  // Active
  for (const [id, d] of Object.entries(_active)) {
    result.push({
      id,
      animeTitle:    d.animeTitle,
      episodeNumber: d.episodeNumber,
      quality:       d.quality,
      destPath:      d.destPath,
      status:        d.paused ? 'paused' : 'downloading',
      percent:       d.total > 0 ? Math.round(d.downloaded / d.total * 100) : 0,
      downloaded:    d.downloaded,
      total:         d.total
    });
  }

  // Queued
  for (const q of _queue) {
    if (q.status === 'queued' || q.status === 'paused') {
      result.push({
        id:            q.id,
        animeTitle:    q.animeTitle,
        episodeNumber: q.episodeNumber,
        quality:       q.quality,
        destPath:      q.destPath,
        status:        q.status,
        percent:       0,
        downloaded:    0,
        total:         0
      });
    }
  }

  return result;
}

module.exports = { init, setLogger, startDownload, pauseDownload, resumeDownload, cancelDownload, getAllDownloads };
