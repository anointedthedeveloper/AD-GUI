'use strict';
/**
 * python_bridge.js
 * Wraps bridge.py — all anime/kwik logic runs in Python exactly as the CLI does.
 */

const { spawn } = require('child_process');
const path      = require('path');

const BRIDGE = path.join(__dirname, 'bridge.py');

let _log = msg => console.log('[bridge]', msg);
function setLogger(fn) { _log = fn; }

/**
 * Run a bridge command. Returns a Promise that resolves with the result data.
 * onProgress(progressObj) is called for download progress lines.
 */
function run(cmdObj, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python', [BRIDGE, JSON.stringify(cmdObj)], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    proc.stderr.on('data', d => _log(`[py stderr] ${d.toString().trim()}`));

    let result = null;
    let error  = null;

    proc.stdout.on('data', chunk => {
      const lines = chunk.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        let obj;
        try { obj = JSON.parse(line); } catch (_) { _log(`[py raw] ${line}`); continue; }

        if (obj.type === 'log')      { _log(obj.message); }
        else if (obj.type === 'progress') { if (onProgress) onProgress(obj); }
        else if (obj.type === 'result')   { result = obj.data; }
        else if (obj.type === 'error')    { error  = obj.message; }
      }
    });

    proc.on('close', code => {
      if (error)        return reject(new Error(error));
      if (result !== null) return resolve(result);
      if (code !== 0)   return reject(new Error(`bridge.py exited with code ${code}`));
      resolve(null);
    });

    proc.on('error', e => reject(new Error(`Failed to start Python: ${e.message}`)));
  });
}

// ── public API (mirrors animepahe.js exports) ─────────────────────────────────

function init() {} // no-op, Python manages its own cache

function hasValidCookies() {
  // sync check — read cache file directly
  const fs   = require('fs');
  const os   = require('os');
  const app  = require('electron').app;
  let cacheFile;
  try { cacheFile = path.join(app.getPath('userData'), 'cookies_cache.json'); }
  catch (_) { cacheFile = path.join(os.homedir(), 'cookies_cache.json'); }

  // Also check next to bridge.py (Python writes it there)
  const bridgeCache = path.join(__dirname, 'cookies_cache.json');

  for (const f of [bridgeCache, cacheFile]) {
    try {
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      const ts   = (data.timestamps || {}).animepahe || 0;
      const age  = Date.now() / 1000 - ts;
      if (data.cookies?.animepahe?.cf_clearance && age < 604800) return true;
    } catch (_) {}
  }
  return false;
}

async function preEmptiveSolve() {
  const result = await run({ cmd: 'solve_cf' });
  if (!result?.solved) throw new Error('CF solve returned false');
}

function isSeriesUrl(url)  { return /^https:\/\/animepahe\.(com|org|ru|si|pw)\/anime\/[a-f0-9\-]{36}$/.test(url); }
function isEpisodeUrl(url) { return /^https:\/\/animepahe\.(com|org|ru|si|pw)\/play\/[a-f0-9\-]{36}\/[a-f0-9]{64}$/.test(url); }
function getSeriesId(url)  { const m = url.match(/anime\/([a-f0-9\-]{36})/); if (!m) throw new Error(`No series ID in: ${url}`); return m[1]; }

async function searchAnime(query)          { return run({ cmd: 'search', query }); }
async function fetchAnimeInfo(id)          { return run({ cmd: 'anime_info', id }); }
async function fetchPoster(id)             { try { return (await fetchAnimeInfo(id)).poster || ''; } catch (_) { return ''; } }
async function fetchMetadata(url, isSeries){ return run({ cmd: 'metadata', url, is_series: isSeries }); }
async function getEpisodeCount(seriesId, url) { const r = await run({ cmd: 'episode_count', series_id: seriesId, url }); return r.total; }
async function fetchSeriesEpisodeLinks(url, epRange) { return run({ cmd: 'episode_links', url, start: epRange[0], end: epRange[1] }); }
async function fetchPaheWinLinks(playUrl, targetRes, audioLang) { return run({ cmd: 'pahe_win_links', play_url: playUrl, res: targetRes, lang: audioLang }); }

// kwik
async function extractKwikLink(paheWinUrl) { return run({ cmd: 'kwik_link', pahe_win_url: paheWinUrl }); }

// download (with progress callback)
function startDownload(id, directUrl, referer, destPath, animeTitle, episodeNumber, quality, onProgress) {
  const destDir  = path.dirname(destPath);
  const filename = path.basename(destPath);
  return run({ cmd: 'download', url: directUrl, referer, dest_dir: destDir, filename }, onProgress);
}

module.exports = {
  init, setLogger, hasValidCookies, preEmptiveSolve,
  isSeriesUrl, isEpisodeUrl, getSeriesId,
  searchAnime, fetchAnimeInfo, fetchPoster, fetchMetadata,
  getEpisodeCount, fetchSeriesEpisodeLinks, fetchPaheWinLinks,
  extractKwikLink, startDownload,
  // stubs so main.js doesn't break
  isFlareSolverrRunning: () => Promise.resolve(true),
  solveCloudflare: (url) => run({ cmd: 'solve_cf' }),
};
