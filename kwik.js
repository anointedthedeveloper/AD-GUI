'use strict';

/**
 * kwik.js — mirrors kwik.py exactly.
 * Uses curl.exe + shared cookie cache from animepahe.js.
 */

const { execFileSync } = require('child_process');
const os   = require('os');
const path = require('path');
const fs   = require('fs');

const CURL = os.platform() === 'win32' ? 'curl.exe' : 'curl';
const BASE_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/';

let _log = msg => console.log('[kwik]', msg);
function setLogger(fn) { _log = fn; }

// ─── JS decoder (mirrors kwik.py exactly) ────────────────────────────────────
function baseConvert(s, fromBase) {
  const h = BASE_ALPHABET.slice(0, fromBase);
  let j = 0;
  const chars = s.split('').reverse();
  for (let idx = 0; idx < chars.length; idx++) {
    const pos = h.indexOf(chars[idx]);
    if (pos !== -1) j += pos * Math.pow(fromBase, idx);
  }
  return Math.round(j);
}

function decodeJS(encoded, alphabet, offset, base) {
  const result = [];
  let i = 0;
  while (i < encoded.length) {
    let s = '';
    while (i < encoded.length && encoded[i] !== alphabet[base]) { s += encoded[i]; i++; }
    for (let j = 0; j < alphabet.length; j++) s = s.split(alphabet[j]).join(String(j));
    result.push(String.fromCharCode(baseConvert(s, base) - offset));
    i++;
  }
  return result.join('');
}

function extractParams(text) {
  const m = text.match(
    /\(\s*"([^",]*)"\s*,\s*\d+\s*,\s*"([^",]*)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*\d+[a-zA-Z]?\s*\)/
  );
  return m ? [m[1], m[2], parseInt(m[3]), parseInt(m[4])] : null;
}

// ─── curl GET (with shared cookies) ──────────────────────────────────────────
function curlGet(url, referer) {
  // lazy-require to avoid circular dep at module load time
  const animepahe = require('./animepahe');
  const cookieStr = animepahe._buildCookieStr(url);
  const ua = animepahe._solvedUa() || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0';

  const hdrFile  = path.join(os.tmpdir(), `kwik_hdr_${Date.now()}.tmp`);
  const bodyFile = path.join(os.tmpdir(), `kwik_bod_${Date.now()}.tmp`);

  const args = [
    '-s', '-S', '--compressed',
    '--max-time', '30', '--connect-timeout', '15',
    '-A', ua,
    '-H', `Referer: ${referer || url}`,
    '-H', `Cookie: ${cookieStr}`,
    '-H', 'Accept: text/html,application/xhtml+xml,*/*;q=0.9',
    '-H', 'Accept-Language: en-US,en;q=0.9',
    '-H', 'Accept-Encoding: gzip, deflate',
    // NO -L: kwik pages must NOT follow redirects automatically
    '-D', hdrFile,
    '-o', bodyFile,
    url
  ];

  try { execFileSync(CURL, args, { timeout: 35000, stdio: ['ignore','ignore','ignore'] }); } catch (_) {}

  let rawHdrs = ''; let body = '';
  try { rawHdrs = fs.readFileSync(hdrFile, 'utf8'); } catch (_) {}
  try { body    = fs.readFileSync(bodyFile, 'utf8'); } catch (_) {}
  try { fs.unlinkSync(hdrFile); } catch (_) {}
  try { fs.unlinkSync(bodyFile); } catch (_) {}

  const sm = rawHdrs.match(/HTTP\/[\d.]+ (\d+)/);
  const status = sm ? parseInt(sm[1]) : 200;

  // Extract Set-Cookie kwik_session
  let kwikSession = '';
  const km = rawHdrs.match(/kwik_session=([^;\s\r\n]*)/i);
  if (km) kwikSession = km[1];

  return { status, text: body, kwikSession };
}

// ─── curl POST no-redirect (mirrors _curl_post_no_redirect) ──────────────────
function curlPostNoRedirect(url, token, referer, cookie) {
  const animepahe = require('./animepahe');
  const ua = animepahe._solvedUa() || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0';

  const args = [
    '-s', '-S',
    '--max-time', '20', '--connect-timeout', '15',
    '-X', 'POST',
    '-A', ua,
    '-H', `Referer: ${referer}`,
    '-H', `Cookie: ${cookie}`,
    '-H', 'Content-Type: application/x-www-form-urlencoded',
    '--data-raw', `_token=${token}`,
    '--no-location',
    '-D', '-',
    '-o', os.platform() === 'win32' ? 'nul' : '/dev/null',
    url
  ];

  let raw = '';
  try {
    raw = execFileSync(CURL, args, { timeout: 25000 }).toString('utf8');
  } catch (e) {
    if (e.stdout) raw = e.stdout.toString('utf8');
    else throw new Error(`curl POST failed: ${e.message}`);
  }

  const statusM = raw.match(/HTTP\/[\d.]+ (\d+)/);
  const status  = statusM ? parseInt(statusM[1]) : 0;
  if (status === 302) {
    const locM = raw.match(/[Ll]ocation:\s*(https?:\/\/\S+)/);
    if (locM) return locM[1].trim();
  }
  throw new Error(`Expected 302 from ${url}, got ${status}`);
}

// ─── fetch kwik direct link (mirrors _fetch_kwik_dlink) ──────────────────────
function fetchKwikDLink(kwikLink, referer, retries = 5) {
  if (retries <= 0) throw new Error(`Exceeded retry limit for: ${kwikLink}`);
  _log(`Fetching kwik page: ${kwikLink} (retries left: ${retries})`);

  const resp = curlGet(kwikLink, referer);
  if (resp.status !== 200) throw new Error(`GET ${kwikLink} → ${resp.status}`);

  const text = resp.text.replace(/\r\n|\n|\r/g, '');
  const kwikSession = resp.kwikSession;

  const params = extractParams(text);
  if (!params) return fetchKwikDLink(kwikLink, referer, retries - 1);

  const [encoded, alphabet, offset, base] = params;
  if (!encoded || !alphabet) return fetchKwikDLink(kwikLink, referer, retries - 1);

  let decoded;
  try { decoded = decodeJS(encoded, alphabet, offset, base); }
  catch (e) { _log(`JS decode failed: ${e.message}`); return fetchKwikDLink(kwikLink, referer, retries - 1); }

  const linkM  = decoded.match(/"(https?:\/\/kwik\.[^/\s"]+\/[^/\s"]+\/[^"\s]*)"/);
  let tokenM   = decoded.match(/name="_token"[^"]*"(\S*)">/);
  if (!tokenM) {
    tokenM = decoded.match(/name=["']_token["'][^>]*value=["']([^"']+)["']/)
          || decoded.match(/value=["']([^"']+)["'][^>]*name=["']_token["']/);
  }

  if (!linkM || !tokenM) {
    _log('Could not find POST url or _token, retrying…');
    return fetchKwikDLink(kwikLink, referer, retries - 1);
  }

  const postUrl  = linkM[1];
  const tokenVal = tokenM[1];

  // mirrors Python: cf_cookies = _sess._cookie_str_for(post_url)
  const animepahe  = require('./animepahe');
  const cfCookies  = animepahe._buildCookieStr(postUrl);
  const fullCookie = cfCookies + (kwikSession ? `; kwik_session=${kwikSession}` : '');

  _log(`POSTing to: ${postUrl}`);
  try {
    return curlPostNoRedirect(postUrl, tokenVal, kwikLink, fullCookie);
  } catch (e) {
    _log(`curl POST failed: ${e.message}, retrying…`);
    return fetchKwikDLink(kwikLink, referer, retries - 1);
  }
}

// ─── public API ───────────────────────────────────────────────────────────────
async function extractKwikLink(paheWinUrl) {
  _log(`Fetching pahe.win page: ${paheWinUrl}`);
  const resp = curlGet(paheWinUrl, paheWinUrl);
  if (resp.status !== 200) throw new Error(`GET ${paheWinUrl} → ${resp.status}`);

  const text = resp.text.replace(/\r\n|\n|\r/g, '');
  let kwikLink = '';

  // Attempt 1 — direct kwik link
  const m1 = text.match(/"(https?:\/\/kwik\.[^/\s"]+\/[^/\s"]+\/[^"\s]*)"/);
  if (m1) { kwikLink = m1[1]; _log(`Found direct kwik link: ${kwikLink}`); }

  // Attempt 2 — decode obfuscated JS
  if (!kwikLink) {
    const params = extractParams(text);
    if (!params) throw new Error(`Cannot extract kwik params from ${paheWinUrl}`);
    const [encoded, alphabet, offset, base] = params;
    const decoded = decodeJS(encoded, alphabet, offset, base);
    const m2 = decoded.match(/"(https?:\/\/kwik\.[^/\s"]+\/[^/\s"]+\/[^"\s]*)"/);
    if (!m2) throw new Error('Cannot find kwik link in decoded JS');
    kwikLink = m2[1].replace(/(https:\/\/kwik\.[^/]+\/)d\//, '$1f/');
    _log(`Decoded kwik link: ${kwikLink}`);
  }

  const directLink = fetchKwikDLink(kwikLink, paheWinUrl);
  _log(`Got direct link: ${directLink}`);
  return { directLink, referer: kwikLink };
}

module.exports = { extractKwikLink, setLogger };
