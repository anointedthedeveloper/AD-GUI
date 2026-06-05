'use strict';

/**
 * animepahe.js — mirrors session.py + animepahe.py exactly.
 *
 * Cookie cache schema (cookies_cache.json):
 *   { cookies: { animepahe: {...}, kwik: {...} },
 *     timestamps: { animepahe: <unix_seconds>, kwik: <unix_seconds> },
 *     ua: "<user_agent>" }
 *
 * Keys:  "animepahe" for animepahe.pw + pahe.win
 *        "kwik"      for kwik.cx / kwik.si / kwik.mn etc.
 *
 * TTL: 7 days (604800 s) — cf_clearance is valid that long on animepahe.
 * On 403: clear stale key, re-solve via FlareSolverr, retry once.
 */

const https  = require('https');
const http   = require('http');
const zlib   = require('zlib');
const fs     = require('fs');
const path   = require('path');
const { execFileSync } = require('child_process');
const { URL } = require('url');
const os     = require('os');

const CURL = os.platform() === 'win32' ? 'curl.exe' : 'curl';

// ─── logger ───────────────────────────────────────────────────────────────────
let _log = msg => console.log('[animepahe]', msg);
function setLogger(fn) { _log = fn; }

// ─── constants ────────────────────────────────────────────────────────────────
const API_BASE  = 'https://animepahe.pw';
const PAGE_BASE = 'https://animepahe.pw';
const FLARESOLVERR_URL = 'http://127.0.0.1:8191/v1';
const COOKIE_TTL = 604800; // 7 days in seconds

const SERIES_URL_RE  = /^https:\/\/animepahe\.(com|org|ru|si|pw)\/anime\/[a-f0-9\-]{36}$/;
const EPISODE_URL_RE = /^https:\/\/animepahe\.(com|org|ru|si|pw)\/play\/[a-f0-9\-]{36}\/[a-f0-9]{64}$/;

// ─── cookie cache (mirrors session.py exactly) ────────────────────────────────
let _cookieCache = {};      // key → {name: value, ...}
let _cookieTs    = {};      // key → unix seconds (float)
let _solvedUa    = '';
let _cacheFile   = null;

function init(userDataPath) {
  _cacheFile = path.join(userDataPath, 'cookies_cache.json');
  _loadCache();
}

function _loadCache() {
  if (!_cacheFile || !fs.existsSync(_cacheFile)) return;
  try {
    const data = JSON.parse(fs.readFileSync(_cacheFile, 'utf8'));
    _cookieCache = data.cookies    || {};
    _cookieTs    = data.timestamps || {};
    _solvedUa    = data.ua         || '';
    _log(`[cache] Loaded cookies for keys: ${Object.keys(_cookieCache).join(', ') || 'none'}`);
  } catch (e) {
    _log(`[cache] Failed to load: ${e.message}`);
  }
}

function _saveCache() {
  if (!_cacheFile) return;
  try {
    fs.writeFileSync(_cacheFile, JSON.stringify({
      cookies:    _cookieCache,
      timestamps: _cookieTs,
      ua:         _solvedUa
    }), 'utf8');
  } catch (e) {
    _log(`[cache] Failed to save: ${e.message}`);
  }
}

// Mirrors session.py _cache_key()
function _cacheKey(url) {
  try {
    const host = new URL(url).hostname;
    if (host.includes('animepahe') || host.includes('pahe.win')) return 'animepahe';
    if (host.includes('kwik'))                                    return 'kwik';
    return host;
  } catch (_) { return url; }
}

// Mirrors session.py _get_cached()
function _getCached(url) {
  const key = _cacheKey(url);
  if (_cookieCache[key]) {
    const age = Date.now() / 1000 - (_cookieTs[key] || 0);
    if (age < COOKIE_TTL) return _cookieCache[key];
    // expired — evict from memory, keep file until re-solve
    delete _cookieCache[key];
    delete _cookieTs[key];
  }
  return {};
}

// Mirrors session.py _set_cached()
function _setCached(url, cookies) {
  const key = _cacheKey(url);
  _cookieCache[key] = cookies;
  _cookieTs[key]    = Date.now() / 1000;   // seconds, matching Python
  _saveCache();
}

function clearCache() {
  _cookieCache = {};
  _cookieTs    = {};
  _saveCache();
}

// Mirrors session.py _build_cookie_str() — cached cookies only (no Chrome DB needed)
function _buildCookieStr(url) {
  const cached = _getCached(url);
  return Object.entries(cached)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// ─── curl-based HTTP (mirrors session.py _curl) ───────────────────────────────
// Uses curl.exe with --compressed so gzip/deflate is handled natively.
function _curlGet(url, extraHeaders = {}) {
  const cookieStr = _buildCookieStr(url);
  const ua = _solvedUa || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0';

  const hdrFile  = path.join(os.tmpdir(), `fs_hdr_${Date.now()}.tmp`);
  const bodyFile = path.join(os.tmpdir(), `fs_bod_${Date.now()}.tmp`);

  const args = [
    '-s', '-S', '--compressed',
    '--max-time', '30', '--connect-timeout', '15',
    '-L', '--max-redirs', '5',
    '-A', ua,
    '-H', `Cookie: ${cookieStr}`,
    '-H', 'Accept: text/html,application/xhtml+xml,application/json,*/*;q=0.9',
    '-H', 'Accept-Language: en-US,en;q=0.9',
    '-H', 'Accept-Encoding: gzip, deflate',
    '-H', 'Connection: keep-alive',
    '-H', 'Sec-Fetch-Dest: document',
    '-H', 'Sec-Fetch-Mode: navigate',
    '-H', 'Sec-Fetch-Site: same-origin',
    '-D', hdrFile,
    '-o', bodyFile,
  ];

  for (const [k, v] of Object.entries(extraHeaders)) {
    if (k.toLowerCase() !== 'cookie') args.push('-H', `${k}: ${v}`);
  }

  args.push(url);

  try {
    execFileSync(CURL, args, { timeout: 35000, stdio: ['ignore', 'ignore', 'ignore'] });
  } catch (e) {
    // curl exits non-zero on some redirects but still writes output — continue
  }

  let rawHdrs = Buffer.alloc(0);
  let body    = Buffer.alloc(0);
  try { rawHdrs = fs.readFileSync(hdrFile); } catch (_) {}
  try { body    = fs.readFileSync(bodyFile); } catch (_) {}
  try { fs.unlinkSync(hdrFile); } catch (_) {}
  try { fs.unlinkSync(bodyFile); } catch (_) {}

  return _parseCurlResponse(rawHdrs, body, url);
}

function _parseCurlResponse(rawHdrs, body, url) {
  let status = 200;
  const hdrs = {};
  // May have multiple response blocks (redirects) — use the last one
  const blocks = rawHdrs.toString('binary').split(/\r?\n\r?\n/);
  let lastBlock = '';
  for (const b of blocks) {
    if (/HTTP\/[\d.]+/.test(b)) lastBlock = b;
  }
  if (lastBlock) {
    const sm = lastBlock.match(/HTTP\/[\d.]+ (\d+)/);
    if (sm) status = parseInt(sm[1]);
    for (const line of lastBlock.split(/\r?\n/)) {
      const ci = line.indexOf(':');
      if (ci > 0 && !line.startsWith('HTTP')) {
        hdrs[line.slice(0, ci).trim().toLowerCase()] = line.slice(ci + 1).trim();
      }
    }
  }
  const text = () => body.toString('utf8');
  const json = () => JSON.parse(body.toString('utf8'));
  return { status, headers: hdrs, body, text, json, _rawHeaders: hdrs };
}

// ─── FlareSolverr ─────────────────────────────────────────────────────────────
function isFlareSolverrRunning() {
  return new Promise(resolve => {
    http.get('http://127.0.0.1:8191/', { timeout: 2000 }, () => resolve(true))
        .on('error', () => resolve(false));
  });
}

// Mirrors session.py solve_cf_once() — skips if valid cookies exist, caches UA
async function solveCloudflare(url) {
  _log(`[solveCloudflare] Checking FlareSolverr for: ${url}`);

  if (!await isFlareSolverrRunning()) {
    throw new Error('FlareSolverr is not running on :8191');
  }

  // Skip if we already have a valid cf_clearance (mirrors Python force=False path)
  const existing = _getCached(url);
  if (existing.cf_clearance) {
    const ageH = (Date.now() / 1000 - (_cookieTs[_cacheKey(url)] || 0)) / 3600;
    _log(`[solveCloudflare] Using cached CF cookies (age: ${ageH.toFixed(1)}h, valid 7 days)`);
    return { cookies: existing, userAgent: _solvedUa };
  }

  _log(`[solveCloudflare] Asking FlareSolverr to solve CF for ${url} (takes 60-180s)…`);

  const payload = JSON.stringify({ cmd: 'request.get', url, maxTimeout: 180000 });

  // POST to FlareSolverr via plain http (no gzip, no redirect issues)
  const result = await new Promise((resolve, reject) => {
    const body = Buffer.from(payload);
    // 200s timeout — longer than FS maxTimeout (180s) so FS always replies first
    const timer = setTimeout(() => reject(new Error('FlareSolverr POST timed out (200s)')), 200000);

    const req = http.request({
      hostname: '127.0.0.1', port: 8191, path: '/v1', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve({ httpStatus: res.statusCode, data });
        } catch (e) {
          reject(new Error(`FlareSolverr non-JSON response: ${Buffer.concat(chunks).toString('utf8').slice(0, 200)}`));
        }
      });
    });
    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.write(body);
    req.end();
  });

  _log(`[solveCloudflare] FlareSolverr HTTP ${result.httpStatus}, status: ${result.data.status}`);

  if (result.data.status !== 'ok') {
    throw new Error(`FlareSolverr: ${result.data.message || JSON.stringify(result.data)}`);
  }

  const solution = result.data.solution || {};
  const cookies  = {};
  for (const c of (solution.cookies || [])) cookies[c.name] = c.value;

  if (solution.userAgent) {
    _solvedUa = solution.userAgent;
    _log(`[solveCloudflare] Captured UA: ${_solvedUa.slice(0, 80)}`);
  }

  _log(`[solveCloudflare] Got ${Object.keys(cookies).length} cookies: ${Object.keys(cookies).join(', ')}`);
  _setCached(url, cookies);

  return { cookies, userAgent: _solvedUa };
}

// Mirrors session.py request() — fast path curl, on 403 re-solve once
async function request(url, extraHeaders = {}) {
  let resp = _curlGet(url, extraHeaders);
  _log(`[request] ${url} → ${resp.status}`);

  if (resp.status !== 403 && resp.status !== 503) return resp;

  _log(`[request] CF challenge (${resp.status}) on ${url} — re-solving…`);

  // Clear stale cookies for this domain before re-solving
  const key = _cacheKey(url);
  delete _cookieCache[key];
  delete _cookieTs[key];

  if (!await isFlareSolverrRunning()) {
    throw new Error(`CF challenge on ${url} and FlareSolverr is not running`);
  }

  // Solve for root domain (mirrors Python: _p.scheme + "://" + _p.netloc)
  const urlObj   = new URL(url);
  const solveUrl = `${urlObj.protocol}//${urlObj.hostname}`;
  await solveCloudflare(solveUrl);

  _log('[request] Bypass succeeded, retrying…');
  resp = _curlGet(url, extraHeaders);
  _log(`[request] Retry → ${resp.status}`);
  return resp;
}

// ─── public helpers ───────────────────────────────────────────────────────────
function hasValidCookies() {
  const cached = _getCached('https://animepahe.pw');
  return !!cached.cf_clearance;
}

// Pre-emptive solve on startup — skip if already have cf_clearance
async function preEmptiveSolve() {
  const cached = _getCached('https://animepahe.pw');
  if (cached.cf_clearance) {
    const ageH = (Date.now() / 1000 - (_cookieTs['animepahe'] || 0)) / 3600;
    _log(`[boot] Valid CF cookies found (age ${ageH.toFixed(1)}h) — skipping pre-emptive solve.`);
    return;
  }
  _log('[boot] No valid CF cookies — solving now…');
  await solveCloudflare('https://animepahe.pw');
}

// ─── AnimePahe API (mirrors animepahe.py) ─────────────────────────────────────
function isSeriesUrl(url)  { return SERIES_URL_RE.test(url); }
function isEpisodeUrl(url) { return EPISODE_URL_RE.test(url); }

function getSeriesId(url) {
  const m = url.match(/anime\/([a-f0-9\-]{36})/);
  if (!m) throw new Error(`Cannot extract series ID from: ${url}`);
  return m[1];
}

async function searchAnime(query) {
  _log(`Searching for: ${query}`);
  const resp = await request(`${API_BASE}/api?m=search&q=${encodeURIComponent(query)}`);
  if (resp.status >= 400) throw new Error(`Search HTTP ${resp.status}`);
  return resp.json().data || [];
}

async function fetchAnimeInfo(animeId) {
  const resp = await request(`${API_BASE}/api?m=anime&id=${animeId}`);
  if (resp.status >= 400) throw new Error(`fetchAnimeInfo HTTP ${resp.status}`);
  return resp.json();
}

async function fetchPoster(animeId) {
  try { return (await fetchAnimeInfo(animeId)).poster || ''; } catch (_) { return ''; }
}

function unescapeHTML(str) {
  return str.replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, m =>
    ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[m]));
}

async function fetchMetadata(url, isSeries) {
  const seriesId = isSeriesUrl(url) ? getSeriesId(url) : null;

  if (seriesId) {
    try {
      const info = await fetchAnimeInfo(seriesId);
      return {
        title: info.title || '', type: info.type || '',
        episode_count: info.episodes || '', poster: info.poster || '',
        session: info.session || '', id: seriesId
      };
    } catch (e) {
      _log(`API metadata failed (${e.message}), falling back to scraping…`);
    }
  }

  _log('Fetching metadata via scraping…');
  const resp = await request(url);
  const text = resp.text().replace(/\r\n|\n|\r/g, '');

  if (isSeries) {
    let title = '', epCount = '', animeType = '', poster = '';
    const t1 = text.match(/style=[^=]+title="([^"]+)"/);             if (t1) title     = unescapeHTML(t1[1]);
    const t2 = text.match(/Type:[^>]*title="[^"]*"[^>]*>([^<]+)<\/a>/); if (t2) animeType = unescapeHTML(t2[1]);
    const t3 = text.match(/Episode[^>]*>\s*(\S*)<\/p/);              if (t3) epCount   = unescapeHTML(t3[1]);
    const t4 = text.match(/(https:\/\/i\.animepahe\.pw\/posters\/[^"]+)/); if (t4) poster    = t4[1];
    return { title, type: animeType, episode_count: epCount, poster };
  } else {
    let title = '', episode = '', poster = '';
    const m = text.match(/title="[^>]*>([^<]*)<\/a>\D*(\d*)<span/);
    if (m) { title = unescapeHTML(m[1]); episode = unescapeHTML(m[2]); }
    const p = text.match(/(https:\/\/i\.animepahe\.pw\/posters\/[^"]+)/);
    if (p) poster = p[1];
    return { title, episode, poster };
  }
}

async function getEpisodeCount(seriesId) {
  const resp = await request(`${API_BASE}/api?m=release&id=${seriesId}&sort=episode_asc&page=1`);
  if (resp.status >= 400) throw new Error(`getEpisodeCount HTTP ${resp.status}`);
  return resp.json().total || 0;
}

function _getPage(n) { return Math.max(1, Math.floor((n + 29) / 30)); }

async function fetchSeriesEpisodeLinks(url, epRange) {
  const seriesId = getSeriesId(url);
  const total    = await getEpisodeCount(seriesId);
  const [start, end] = epRange;

  if (start > total || end > total)
    throw new Error(`Episode range ${start}-${end} out of bounds (total: ${total})`);

  const links = [];
  for (let page = _getPage(start); page <= _getPage(end); page++) {
    _log(`Fetching episode page ${page}…`);
    const resp = await request(`${API_BASE}/api?m=release&id=${seriesId}&sort=episode_asc&page=${page}`);
    if (resp.status >= 400) throw new Error(`Episode page HTTP ${resp.status}`);
    for (const ep of (resp.json().data || []))
      links.push(`${PAGE_BASE}/play/${seriesId}/${ep.session || ''}`);
  }

  const offset = (_getPage(start) - 1) * 30;
  return links.filter((_, i) => start <= offset + i + 1 && offset + i + 1 <= end);
}

async function fetchPaheWinLinks(playUrl, targetRes, audioLang) {
  const resp = await request(playUrl);
  if (resp.status >= 400) throw new Error(`fetchPaheWinLinks HTTP ${resp.status}`);
  const text = resp.text().replace(/\r\n|\n|\r/g, '');

  const candidates = [];

  // Attempt 1: JSON in <script> tag
  const jm = text.match(/let\s+links\s*=\s*(\{.*?\})\s*;?\s*(?:let|var|const|<\/)/);
  if (jm) {
    try {
      const linksJson = JSON.parse(jm[1]);
      for (const resolutions of Object.values(linksJson)) {
        for (const [resStr, sources] of Object.entries(resolutions)) {
          if (typeof sources !== 'object') continue;
          const paheWin = sources.kwik_pahewin || sources.kwik;
          let lang = sources.audio || 'jpn';
          if (lang.toLowerCase().includes('eng') || ['en','dub'].includes(lang.toLowerCase())) lang = 'en';
          else if (lang.toLowerCase().includes('chi') || lang.toLowerCase() === 'zh') lang = 'zh';
          else lang = 'jp';
          const resMatch = resStr.match(/\d+/);
          if (paheWin) candidates.push({ dPaheLink: paheWin, epRes: resMatch ? parseInt(resMatch[0]) : 0, epLang: lang });
        }
      }
    } catch (e) { _log(`JSON links parse failed: ${e.message}`); }
  }

  // Attempt 2: <a href="https://pahe.win/...">
  if (!candidates.length) {
    const ar = /<a href="(https?:\/\/pahe\.win\/\S*)"[^>]*>(.*?)<\/a>/g;
    let m;
    while ((m = ar.exec(text)) !== null) {
      const dLink   = unescapeHTML(m[1]);
      const block   = m[2];
      const resM    = block.match(/\b(\d{3,4})p\b/);
      let lang = 'jp';
      const spanR = /<span[^>]*>([^<]*)<\/span>/g;
      let sm;
      while ((sm = spanR.exec(block)) !== null) {
        const s = sm[1].trim().toLowerCase();
        if (s === 'dub') { lang = 'en'; break; }
        else if (s === 'chi') { lang = 'zh'; break; }
        else if (s !== 'bd' && s !== '') { lang = s; break; }
      }
      candidates.push({ dPaheLink: dLink, epRes: resM ? parseInt(resM[1]) : 0, epLang: lang });
    }
  }

  // Attempt 3: kwik.cx direct
  if (!candidates.length) {
    const kr = /href="(https?:\/\/kwik\.cx\/e\/[^"]+)"/g;
    let m;
    while ((m = kr.exec(text)) !== null)
      candidates.push({ dPaheLink: m[1], epRes: 0, epLang: 'jp' });
  }

  if (!candidates.length) throw new Error(`No download links found on ${playUrl}`);

  const filtered = candidates.filter(c => c.epLang === audioLang);
  const pool     = filtered.length ? filtered : candidates;

  if (targetRes === 0)  return pool.reduce((a, b) => a.epRes > b.epRes ? a : b);
  if (targetRes === -1) return pool.reduce((a, b) => a.epRes < b.epRes ? a : b);
  return pool.find(c => c.epRes === targetRes) || pool.reduce((a, b) => a.epRes > b.epRes ? a : b);
}

module.exports = {
  init, setLogger,
  hasValidCookies, preEmptiveSolve, solveCloudflare, isFlareSolverrRunning,
  isSeriesUrl, isEpisodeUrl, getSeriesId,
  searchAnime, fetchAnimeInfo, fetchPoster,
  fetchMetadata, getEpisodeCount, fetchSeriesEpisodeLinks, fetchPaheWinLinks,
  // expose cache internals for kwik.js
  _getCached, _setCached, _cacheKey, _buildCookieStr, _solvedUa: () => _solvedUa
};
