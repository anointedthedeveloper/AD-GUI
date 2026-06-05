const https = require('https');
const http = require('http');
const { URL } = require('url');

// ─── Logger (replaced by main.js via setLogger) ───────────────────────────────
let _log = (msg) => console.log('[animepahe]', msg);
function setLogger(fn) { _log = fn; }

// API calls and page requests go to .pw (unified to prevent CF bypass mismatch)
const API_BASE = 'https://animepahe.pw';
const PAGE_BASE = 'https://animepahe.pw';

const SERIES_URL_RE = /^https:\/\/animepahe\.(com|org|ru|si|pw)\/anime\/[a-f0-9\-]{36}$/;
const EPISODE_URL_RE = /^https:\/\/animepahe\.(com|org|ru|si|pw)\/play\/[a-f0-9\-]{36}\/[a-f0-9]{64}$/;

// User agent
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0';

// Cookie cache
let cookieCache = {};
let cookieTimestamps = {};
const COOKIE_TTL = 604800; // 7 days

// FlareSolverr URL
const FLARESOLVERR_URL = 'http://127.0.0.1:8191/v1';

let _cacheFile = null;

// Initialize with userData path
function init(userDataPath) {
  const path = require('path');
  _cacheFile = path.join(userDataPath, 'cf_cookies.json');
  loadCookieCache();
}

// Load cookies from cache file
function loadCookieCache() {
  if (!_cacheFile) return;
  try {
    const fs = require('fs');
    if (fs.existsSync(_cacheFile)) {
      const data = JSON.parse(fs.readFileSync(_cacheFile, 'utf8'));
      cookieCache = data.cookies || {};
      cookieTimestamps = data.timestamps || {};
    }
  } catch (e) {
    _log(`Failed to load cookie cache: ${e.message}`);
  }
}

// Save cookies to cache file
function saveCookieCache() {
  if (!_cacheFile) return;
  try {
    const fs = require('fs');
    const data = {
      cookies: cookieCache,
      timestamps: cookieTimestamps
    };
    fs.writeFileSync(_cacheFile, JSON.stringify(data), 'utf8');
  } catch (e) {
    _log(`Failed to save cookie cache: ${e.message}`);
  }
}

// Get cache key for URL
function getCacheKey(url) {
  try {
    const hostname = new URL(url).hostname;
    if (hostname.includes('animepahe') || hostname.includes('pahe.win')) {
      return 'animepahe';
    }
    if (hostname.includes('kwik')) {
      return 'kwik';
    }
    return hostname;
  } catch (e) {
    return url;
  }
}

// Get cached cookies if valid
function getCachedCookies(url) {
  const key = getCacheKey(url);
  if (cookieCache[key]) {
    const age = (Date.now() - (cookieTimestamps[key] || 0)) / 1000;
    if (age < COOKIE_TTL) {
      return cookieCache[key];
    }
    // Expired
    delete cookieCache[key];
    delete cookieTimestamps[key];
  }
  return {};
}

// Set cached cookies
function setCachedCookies(url, cookies) {
  const key = getCacheKey(url);
  cookieCache[key] = cookies;
  cookieTimestamps[key] = Date.now();
  saveCookieCache();
}

// Build cookie string
function buildCookieString(url) {
  const cached = getCachedCookies(url);
  return Object.entries(cached)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// HTTP request function
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const headers = {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.9',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate',
      'Connection': 'keep-alive',
      'Cookie': buildCookieString(url),
      ...options.headers
    };

    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: headers
    };

    const req = client.request(requestOptions, (res) => {
      let data = [];
      res.on('data', (chunk) => data.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(data);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: body,
          text: () => body.toString('utf8'),
          json: () => JSON.parse(body.toString('utf8'))
        });
      });
    });

    req.on('error', reject);
    
    if (options.data) {
      req.write(options.data);
    }
    
    req.end();
  });
}

// Check if FlareSolverr is running
function isFlareSolverrRunning() {
  return new Promise((resolve) => {
    http.get('http://127.0.0.1:8191/', { timeout: 1000 }, (res) => {
      resolve(true);
    }).on('error', () => {
      resolve(false);
    });
  });
}

// Solve Cloudflare with FlareSolverr
async function solveCloudflare(url) {
  const isRunning = await isFlareSolverrRunning();
  if (!isRunning) {
    throw new Error('FlareSolverr is not running. Please start it first.');
  }

  const payload = JSON.stringify({
    cmd: 'request.get',
    url: url,
    maxTimeout: 180000
  });

  const options = {
    hostname: '127.0.0.1',
    port: 8191,
    path: '/v1',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    data: payload
  };

  const response = await httpRequest(FLARESOLVERR_URL, options);
  const data = response.json();

  if (data.status !== 'ok') {
    throw new Error(`FlareSolverr: ${data.message || 'unknown error'}`);
  }

  const solution = data.solution || {};
  const cookies = {};
  (solution.cookies || []).forEach(c => {
    cookies[c.name] = c.value;
  });

  setCachedCookies(url, cookies);
  
  return {
    status: solution.status || 200,
    html: solution.response || '',
    cookies: cookies,
    userAgent: solution.userAgent || ''
  };
}

// Request with CF bypass
async function request(url, options = {}) {
  try {
    const response = await httpRequest(url, options);
    if (response.status !== 403 && response.status !== 503) {
      return response;
    }
  } catch (e) {
    // If request fails due to socket error, fall through to CF bypass
  }

  // Try CF bypass on 403/503
  const isRunning = await isFlareSolverrRunning();
  if (isRunning) {
    _log(`CF challenge on ${url} — solving with FlareSolverr...`);
    try {
      const urlObj = new URL(url);
      const solveUrl = `${urlObj.protocol}//${urlObj.hostname}`;
      await solveCloudflare(solveUrl);
      _log('CF bypass succeeded, retrying...');
      return await httpRequest(url, options);
    } catch (e) {
      _log(`FlareSolverr bypass failed: ${e.message}`);
    }
  }

  throw new Error(`Request failed for ${url}`);
}

// Pre-emptive solve
async function preEmptiveSolve() {
  const domains = ['https://animepahe.pw', 'https://pahe.win'];
  for (const url of domains) {
    _log(`Pre-emptively solving CF for ${url}...`);
    try {
      await solveCloudflare(url);
      _log(`Pre-emptive solve for ${url} successful.`);
    } catch (e) {
      _log(`Pre-emptive solve for ${url} failed: ${e.message}`);
      throw e;
    }
  }
}

// Check if cookies are valid
function hasValidCookies() {
  // If we have animepahe cookies less than 7 days old, we consider it valid
  const cached = getCachedCookies('https://animepahe.pw');
  return Object.keys(cached).length > 0;
}

// Search anime
async function searchAnime(query) {
  _log(`Searching for: ${query}`);
  const url = `${API_BASE}/api?m=search&q=${encodeURIComponent(query)}`;
  const response = await request(url);
  const data = response.json();
  return data.data || [];
}

// Fetch anime info
async function fetchAnimeInfo(animeId) {
  const url = `${API_BASE}/api?m=anime&id=${animeId}`;
  const response = await request(url);
  return response.json();
}

// Fetch poster
async function fetchPoster(animeId) {
  try {
    const info = await fetchAnimeInfo(animeId);
    return info.poster || '';
  } catch (e) {
    return '';
  }
}

// Check if series URL
function isSeriesUrl(url) {
  return SERIES_URL_RE.test(url);
}

// Check if episode URL
function isEpisodeUrl(url) {
  return EPISODE_URL_RE.test(url);
}

// Get series ID from URL
function getSeriesId(url) {
  const match = url.match(/anime\/([a-f0-9\-]{36})/);
  if (!match) {
    throw new Error(`Cannot extract series ID from: ${url}`);
  }
  return match[1];
}

// Fetch metadata
async function fetchMetadata(url, isSeries) {
  const seriesId = isSeriesUrl(url) ? getSeriesId(url) : null;
  
  if (seriesId) {
    try {
      const info = await fetchAnimeInfo(seriesId);
      return {
        title: info.title || '',
        type: info.type || '',
        episode_count: info.episodes || '',
        poster: info.poster || '',
        session: info.session || '',
        id: seriesId
      };
    } catch (e) {
      _log(`API metadata failed (${e.message}), falling back to scraping...`);
    }
  }

  // Scrape fallback
  _log('Fetching metadata via scraping...');
  const response = await request(url);
  const text = response.text().replace(/\r\n/g, '').replace(/\n/g, '').replace(/\r/g, '');

  if (isSeries) {
    let title = '', epCount = '', animeType = '', poster = '';
    
    const titleMatch = text.match(/style=[^=]+title="([^"]+)"/);
    if (titleMatch) title = unescapeHTML(titleMatch[1]);
    
    const typeMatch = text.match(/Type:[^>]*title="[^"]*"[^>]*>([^<]+)<\/a>/);
    if (typeMatch) animeType = unescapeHTML(typeMatch[1]);
    
    const epMatch = text.match(/Episode[^>]*>\s*(\S*)<\/p/);
    if (epMatch) epCount = unescapeHTML(epMatch[1]);
    
    const posterMatch = text.match(/(https:\/\/i\.animepahe\.pw\/posters\/[^"]+)/);
    if (posterMatch) poster = posterMatch[1];
    
    return { title, type: animeType, episode_count: epCount, poster };
  } else {
    let title = '', episode = '', poster = '';
    
    const match = text.match(/title="[^>]*>([^<]*)<\/a>\D*(\d*)<span/);
    if (match) {
      title = unescapeHTML(match[1]);
      episode = unescapeHTML(match[2]);
    }
    
    const posterMatch = text.match(/(https:\/\/i\.animepahe\.pw\/posters\/[^"]+)/);
    if (posterMatch) poster = posterMatch[1];
    
    return { title, episode, poster };
  }
}

// Get episode count
async function getEpisodeCount(seriesId, url) {
  const apiUrl = `${API_BASE}/api?m=release&id=${seriesId}&sort=episode_asc&page=1`;
  const response = await request(apiUrl);
  const data = response.json();
  return data.total || 0;
}

// Get page number for episode
function getPageNumber(n) {
  return Math.max(1, Math.floor((n + 29) / 30));
}

// Fetch series episode links
async function fetchSeriesEpisodeLinks(url, epRange) {
  const seriesId = getSeriesId(url);
  const total = await getEpisodeCount(seriesId, url);
  const [start, end] = epRange;

  if (start > total || end > total) {
    throw new Error(`Episode range ${start}-${end} out of bounds (total: ${total})`);
  }

  const links = [];
  for (let page = getPageNumber(start); page <= getPageNumber(end); page++) {
    console.log(`Fetching page ${page}...`);
    const apiUrl = `${API_BASE}/api?m=release&id=${seriesId}&sort=episode_asc&page=${page}`;
    const response = await request(apiUrl);
    const data = response.json();
    
    for (const ep of data.data || []) {
      links.push(`${PAGE_BASE}/play/${seriesId}/${ep.session || ''}`);
    }
  }

  const offset = (getPageNumber(start) - 1) * 30;
  return links.filter((_, i) => start <= offset + i + 1 <= end);
}

// Fetch pahe win links
async function fetchPaheWinLinks(playUrl, targetRes, audioLang) {
  const response = await request(playUrl);
  const text = response.text().replace(/\r\n/g, '').replace(/\n/g, '').replace(/\r/g, '');

  const candidates = [];

  // Attempt 1: JSON in <script> tag
  const jsonMatch = text.match(/let\s+links\s*=\s*(\{.*?\})\s*;?\s*(?:let|var|const|<\/)/);
  if (jsonMatch) {
    try {
      const linksJson = JSON.parse(jsonMatch[1]);
      for (const [epKey, resolutions] of Object.entries(linksJson)) {
        for (const [resStr, sources] of Object.entries(resolutions)) {
          if (typeof sources === 'object') {
            const paheWin = sources.kwik_pahewin || sources.kwik;
            let lang = sources.audio || 'jpn';
            
            // Normalize language code
            if (lang.toLowerCase().includes('eng') || ['en', 'dub'].includes(lang.toLowerCase())) {
              lang = 'en';
            } else if (lang.toLowerCase().includes('chi') || ['zh'].includes(lang.toLowerCase())) {
              lang = 'zh';
            } else {
              lang = 'jp';
            }
            
            const resMatch = resStr.match(/\d+/);
            const res = resMatch ? parseInt(resMatch[0]) : 0;
            
            if (paheWin) {
              candidates.push({ dPaheLink: paheWin, epRes: res, epLang: lang });
            }
          }
        }
      }
    } catch (e) {
      _log(`Failed to parse JSON links: ${e.message}`);
    }
  }

  // Attempt 2: <a href="https://pahe.win/..."> anchor tags
  if (candidates.length === 0) {
    const anchorRegex = /<a href="(https?:\/\/pahe\.win\/\S*)"[^>]*>(.*?)<\/a>/g;
    let match;
    while ((match = anchorRegex.exec(text)) !== null) {
      const dLink = unescapeHTML(match[1]);
      const block = match[2];
      const resMatch = block.match(/\b(\d{3,4})p\b/);
      const res = resMatch ? parseInt(resMatch[1]) : 0;
      let lang = 'jp';
      
      const spanRegex = /<span[^>]*>([^<]*)<\/span>/g;
      let spanMatch;
      while ((spanMatch = spanRegex.exec(block)) !== null) {
        const s = spanMatch[1].trim().toLowerCase();
        if (s === 'dub') {
          lang = 'en';
          break;
        } else if (s === 'chi') {
          lang = 'zh';
          break;
        } else if (s !== 'bd' && s !== '') {
          lang = s;
          break;
        }
      }
      
      candidates.push({ dPaheLink: dLink, epRes: res, epLang: lang });
    }
  }

  // Attempt 3: kwik.cx links directly
  if (candidates.length === 0) {
    const kwikRegex = /href="(https?:\/\/kwik\.cx\/e\/[^"]+)"/g;
    let match;
    while ((match = kwikRegex.exec(text)) !== null) {
      candidates.push({ dPaheLink: match[1], epRes: 0, epLang: 'jp' });
    }
  }

  if (candidates.length === 0) {
    throw new Error(`No download links found on ${playUrl}`);
  }

  const filtered = candidates.filter(c => c.epLang === audioLang);
  const finalFiltered = filtered.length > 0 ? filtered : candidates;

  if (targetRes === 0) {
    return finalFiltered.reduce((a, b) => a.epRes > b.epRes ? a : b);
  } else if (targetRes === -1) {
    return finalFiltered.reduce((a, b) => a.epRes < b.epRes ? a : b);
  } else {
    const exact = finalFiltered.find(c => c.epRes === targetRes);
    return exact || finalFiltered.reduce((a, b) => a.epRes > b.epRes ? a : b);
  }
}

// Unescape HTML
function unescapeHTML(str) {
  const map = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'"
  };
  return str.replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, m => map[m]);
}

module.exports = {
  init,
  hasValidCookies,
  preEmptiveSolve,
  setLogger,
  searchAnime,
  fetchAnimeInfo,
  fetchPoster,
  isSeriesUrl,
  isEpisodeUrl,
  getSeriesId,
  fetchMetadata,
  getEpisodeCount,
  fetchSeriesEpisodeLinks,
  fetchPaheWinLinks,
  solveCloudflare,
  isFlareSolverrRunning
};
