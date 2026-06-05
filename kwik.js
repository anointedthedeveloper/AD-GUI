/**
 * kwik.js — Kwik.cx direct link extractor
 *
 * Mirrors kwik.py exactly:
 *  1. Fetch pahe.win page  → extract kwik /f/ link
 *  2. Fetch kwik /f/ page  → decode obfuscated JS → extract POST url + _token
 *  3. curl POST _token with no-redirect → grab Location header (direct .mp4)
 */

'use strict';

const https  = require('https');
const http   = require('http');
const { URL } = require('url');
const { execFileSync } = require('child_process');
const path   = require('path');
const os     = require('os');

// On Windows use curl.exe (available since Win10 1803)
const CURL = os.platform() === 'win32' ? 'curl.exe' : 'curl';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0';
const BASE_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/';

// ─── logging ─────────────────────────────────────────────────────────────────
let _log = (msg) => console.log('[kwik]', msg);
function setLogger(fn) { _log = fn; }

// ─── base conversion (mirrors _base_convert in kwik.py) ──────────────────────
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

// ─── JS decoder (mirrors _decode_js in kwik.py) ──────────────────────────────
function decodeJS(encoded, alphabet, offset, base) {
  const result = [];
  let i = 0;
  while (i < encoded.length) {
    let s = '';
    while (i < encoded.length && encoded[i] !== alphabet[base]) {
      s += encoded[i];
      i++;
    }
    for (let j = 0; j < alphabet.length; j++) {
      s = s.split(alphabet[j]).join(String(j));
    }
    result.push(String.fromCharCode(baseConvert(s, base) - offset));
    i++;
  }
  return result.join('');
}

// ─── extract obfuscation params from page text ───────────────────────────────
function extractParams(text) {
  const m = text.match(
    /\(\s*"([^",]*)"\s*,\s*\d+\s*,\s*"([^",]*)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*\d+[a-zA-Z]?\s*\)/
  );
  if (!m) return null;
  return [m[1], m[2], parseInt(m[3]), parseInt(m[4])];
}

// ─── HTTP GET helper (plain Node https/http, no redirect follow) ─────────────
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        ...headers
      }
    };
    const req = client.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        text: () => Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── curl POST with no redirect (mirrors _curl_post_no_redirect) ─────────────
function curlPostNoRedirect(url, token, referer, cookie) {
  const args = [
    '-s', '-S',
    '--max-time', '20',
    '--connect-timeout', '15',
    '-X', 'POST',
    '-A', UA,
    '-H', `Referer: ${referer}`,
    '-H', `Cookie: ${cookie}`,
    '-H', 'Content-Type: application/x-www-form-urlencoded',
    '--data-raw', `_token=${token}`,
    '--no-location',
    '-D', '-',
    '-o', os.platform() === 'win32' ? 'nul' : '/dev/null',
    url
  ];

  let raw;
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
async function fetchKwikDLink(kwikLink, referer, retries = 5) {
  if (retries <= 0) throw new Error(`Exceeded retry limit for: ${kwikLink}`);

  _log(`Fetching kwik page: ${kwikLink} (retries left: ${retries})`);

  let resp;
  try {
    resp = await httpGet(kwikLink, { Referer: referer });
  } catch (e) {
    throw new Error(`GET ${kwikLink} failed: ${e.message}`);
  }

  if (resp.status !== 200) {
    throw new Error(`GET ${kwikLink} → ${resp.status}`);
  }

  const text = resp.text().replace(/\r\n/g, '').replace(/\n/g, '').replace(/\r/g, '');

  // Extract kwik_session cookie from response headers
  let kwikSession = '';
  const rawHdrs = JSON.stringify(resp.headers);
  const sessM = rawHdrs.match(/kwik_session=([^;"\s]*)/);
  if (sessM) kwikSession = sessM[1];

  const params = extractParams(text);
  if (!params) return fetchKwikDLink(kwikLink, referer, retries - 1);

  const [encoded, alphabet, offset, base] = params;
  if (!encoded || !alphabet) return fetchKwikDLink(kwikLink, referer, retries - 1);

  let decoded;
  try {
    decoded = decodeJS(encoded, alphabet, offset, base);
  } catch (e) {
    _log(`JS decode failed: ${e.message}`);
    return fetchKwikDLink(kwikLink, referer, retries - 1);
  }

  // Extract POST url (kwik /f/ link)
  const linkM  = decoded.match(/"(https?:\/\/kwik\.[^/\s"]+\/[^/\s"]+\/[^"\s]*)"/);
  // Extract _token
  let tokenM = decoded.match(/name="_token"[^"]*"(\S*)">/);
  if (!tokenM) {
    tokenM = decoded.match(/name=["']_token["'][^>]*value=["']([^"']+)["']/)
          || decoded.match(/value=["']([^"']+)["'][^>]*name=["']_token["']/);
  }

  if (!linkM || !tokenM) {
    _log('Could not find POST url or _token, retrying...');
    return fetchKwikDLink(kwikLink, referer, retries - 1);
  }

  const postUrl  = linkM[1];
  const tokenVal = tokenM[1];
  const cookie   = kwikSession ? `kwik_session=${kwikSession}` : '';

  _log(`POSTing to: ${postUrl}`);
  try {
    return curlPostNoRedirect(postUrl, tokenVal, kwikLink, cookie);
  } catch (e) {
    _log(`curl POST failed: ${e.message}, retrying...`);
    return fetchKwikDLink(kwikLink, referer, retries - 1);
  }
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Given a pahe.win URL, resolve to a direct downloadable .mp4 URL.
 * Returns { directLink, referer }
 */
async function extractKwikLink(paheWinUrl) {
  _log(`Fetching pahe.win page: ${paheWinUrl}`);
  const resp = await httpGet(paheWinUrl);
  if (resp.status !== 200) throw new Error(`GET ${paheWinUrl} → ${resp.status}`);

  const text = resp.text().replace(/\r\n/g, '').replace(/\n/g, '').replace(/\r/g, '');

  let kwikLink = '';

  // Attempt 1 — direct kwik link in page
  const m1 = text.match(/"(https?:\/\/kwik\.[^/\s"]+\/[^/\s"]+\/[^"\s]*)"/);
  if (m1) {
    kwikLink = m1[1];
    _log(`Found direct kwik link: ${kwikLink}`);
  }

  // Attempt 2 — decode obfuscated JS
  if (!kwikLink) {
    const params = extractParams(text);
    if (!params) throw new Error(`Cannot extract kwik params from ${paheWinUrl}`);
    const [encoded, alphabet, offset, base] = params;
    const decoded = decodeJS(encoded, alphabet, offset, base);
    const m2 = decoded.match(/"(https?:\/\/kwik\.[^/\s"]+\/[^/\s"]+\/[^"\s]*)"/);
    if (!m2) throw new Error('Cannot find kwik link in decoded JS');
    // Replace /d/ with /f/ (mirrors CLI: RE2::Replace)
    kwikLink = m2[1].replace(/(https:\/\/kwik\.[^/]+\/)d\//, '$1f/');
    _log(`Decoded kwik link: ${kwikLink}`);
  }

  const directLink = await fetchKwikDLink(kwikLink, paheWinUrl);
  _log(`Got direct link: ${directLink}`);
  return { directLink, referer: kwikLink };
}

module.exports = { extractKwikLink, setLogger };
