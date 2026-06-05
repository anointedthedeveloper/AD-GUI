"""
session.py — HTTP with smart Cloudflare bypass.

Key design:
- CF cookies are cached to disk and survive app restarts
- TTL is 7 days — cf_clearance is valid that long on animepahe
- On 403: auto re-solve once, then retry (only when truly needed)
- solve_cf_once() skips if valid cookies already exist in cache
"""

import os, re, json, shutil, sqlite3, tempfile, subprocess, time, sys, threading

# On Windows PowerShell, 'curl' is an alias for Invoke-WebRequest.
# We must use 'curl.exe' to get the real curl binary.
_CURL = "curl.exe" if sys.platform == "win32" else "curl"
from pathlib import Path

# ── optional libs ─────────────────────────────────────────────────────────────

try:
    import cloudscraper as _cslib
    HAS_CLOUDSCRAPER = True
except ImportError:
    HAS_CLOUDSCRAPER = False

try:
    import browser as _browser
    HAS_BROWSER = _browser.HAS_SELENIUM
except ImportError:
    HAS_BROWSER = False

try:
    import flaresolverr as _fs_mod
    HAS_FLARESOLVERR = True
except ImportError:
    HAS_FLARESOLVERR = False

try:
    import cf_solver as _cf_solver
    HAS_UC = _cf_solver.is_available()
except ImportError:
    HAS_UC = False

# ── cookie cache ──────────────────────────────────────────────────────────────

_CACHE_FILE = Path(__file__).parent / "cookies_cache.json"
_cookie_cache: dict    = {}   # "animepahe" / "kwik" → {name: value}
_cookie_ts:    dict    = {}   # key → solved timestamp
_COOKIE_TTL            = 604800  # 7 days — cf_clearance lasts this long
_solved_ua:    str     = ""

def _load_cache():
    """Load cookies from disk. Never evict on load — let 403s decide."""
    global _cookie_cache, _cookie_ts, _solved_ua
    if _CACHE_FILE.exists():
        try:
            data = json.loads(_CACHE_FILE.read_text(encoding="utf-8"))
            _cookie_cache = data.get("cookies", {})
            _cookie_ts    = data.get("timestamps", {})
            _solved_ua    = data.get("ua", "")
        except Exception:
            pass

def _save_cache():
    global _solved_ua
    try:
        data = {
            "cookies": _cookie_cache,
            "timestamps": _cookie_ts,
            "ua": _solved_ua
        }
        _CACHE_FILE.write_text(json.dumps(data), encoding="utf-8")
    except Exception:
        pass

_load_cache()

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0"
)

CHROME_COOKIE_DB = (
    Path(os.environ.get("LOCALAPPDATA", ""))
    / "Google/Chrome/User Data/Default/Network/Cookies"
)
CHROME_LOCAL_STATE = (
    Path(os.environ.get("LOCALAPPDATA", ""))
    / "Google/Chrome/User Data/Local State"
)


# ── Chrome cookie reader ──────────────────────────────────────────────────────

def _get_key() -> bytes:
    import base64
    try:
        import win32crypt
        raw = json.loads(CHROME_LOCAL_STATE.read_text(encoding="utf-8"))
        enc = base64.b64decode(raw["os_crypt"]["encrypted_key"])[5:]
        return win32crypt.CryptUnprotectData(enc, None, None, None, 0)[1]
    except Exception:
        return b""

def _decrypt(enc: bytes, key: bytes) -> str:
    if not enc:
        return ""
    try:
        if enc[:3] in (b"v10", b"v20"):
            if not key:
                return ""
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            return AESGCM(key).decrypt(enc[3:15], enc[15:], None).decode("utf-8", errors="replace")
        import win32crypt
        return win32crypt.CryptUnprotectData(enc, None, None, None, 0)[1].decode("utf-8", errors="replace")
    except Exception:
        return ""

def _chrome_cookies(domain_fragment: str) -> dict:
    if not CHROME_COOKIE_DB.exists():
        return {}
    tmp = tempfile.mktemp(suffix=".db")
    try:
        shutil.copy2(str(CHROME_COOKIE_DB), tmp)
    except Exception:
        try:
            with open(CHROME_COOKIE_DB, "rb") as f:
                with open(tmp, "wb") as g:
                    g.write(f.read())
        except Exception:
            return {}
    key = _get_key()
    result = {}
    try:
        conn = sqlite3.connect(tmp)
        rows = conn.execute(
            "SELECT name, encrypted_value FROM cookies WHERE host_key LIKE ?",
            (f"%{domain_fragment}%",)
        ).fetchall()
        conn.close()
        for name, enc_val in rows:
            val = _decrypt(bytes(enc_val), key)
            if val:
                result[name] = val
    except Exception:
        pass
    finally:
        try: os.unlink(tmp)
        except: pass
    return result

def _cookie_str_for(url: str) -> str:
    """Read Chrome cookies for this domain."""
    from urllib.parse import urlparse
    host = urlparse(url).hostname or ""
    frag = None
    for f in ("animepahe", "pahe.win", "kwik"):
        if f in host:
            frag = f
            break
    cookies = {"__ddg2_": ""}
    if frag:
        chrome = _chrome_cookies(frag)
        for name in ("cf_clearance", "__ddg1_", "__ddg2_"):
            if name in chrome:
                cookies[name] = chrome[name]
    return "; ".join(f"{k}={v}" for k, v in cookies.items())

# public alias used by kwik.py / downloader.py
_cookie_str_for = _cookie_str_for


# ── cache helpers ─────────────────────────────────────────────────────────────

def _cache_key(url: str) -> str:
    from urllib.parse import urlparse
    host = urlparse(url).hostname or url
    if "animepahe" in host or "pahe.win" in host:
        return "animepahe"
    if "kwik" in host:
        return "kwik"
    return host

def _get_cached(url: str) -> dict:
    """Return cached cookies if they exist and are within TTL."""
    key = _cache_key(url)
    if key in _cookie_cache:
        age = time.time() - _cookie_ts.get(key, 0)
        if age < _COOKIE_TTL:
            return _cookie_cache[key]
        # Expired — remove from memory but keep the file until re-solve
        _cookie_cache.pop(key, None)
        _cookie_ts.pop(key, None)
    return {}

def _set_cached(url: str, cookies: dict):
    key = _cache_key(url)
    _cookie_cache[key] = cookies
    _cookie_ts[key]    = time.time()
    _save_cache()

def clear_cache():
    _cookie_cache.clear()
    _cookie_ts.clear()
    _save_cache()

def _build_cookie_str(url: str) -> str:
    """Merge Chrome cookies + cached solved cookies."""
    merged = {}
    for part in _cookie_str_for(url).split("; "):
        if "=" in part:
            k, _, v = part.partition("=")
            merged[k.strip()] = v.strip()
    for k, v in _get_cached(url).items():
        if v:
            merged[k] = v
    return "; ".join(f"{k}={v}" for k, v in merged.items() if v)


# ── FlareSolverr: solve ONCE, cache cookies ───────────────────────────────────

log_callback = None

def set_log_callback(cb):
    global log_callback
    log_callback = cb
    if HAS_FLARESOLVERR and hasattr(_fs_mod, "set_log_callback"):
        _fs_mod.set_log_callback(cb)

def log(msg: str):
    if log_callback:
        log_callback(msg)
    else:
        print(msg)


def flaresolverr_running() -> bool:
    """Quick check if FlareSolverr is up (non-blocking, 1s timeout)."""
    if not HAS_FLARESOLVERR:
        return False
    try:
        import urllib.request
        urllib.request.urlopen("http://localhost:8191/", timeout=1)
        return True
    except Exception:
        return False

_fs_lock = threading.Lock()

def solve_cf_once(url="https://animepahe.pw", log_fn=None, force=False, log=None) -> bool:
    """
    Call FlareSolverr ONCE to get cf_clearance for the given url.
    Auto-starts the bundled exe if needed.
    """
    global _solved_ua
    _log = log_fn or log or globals().get('log')
    if not HAS_FLARESOLVERR:
        _log("FlareSolverr library not available.")
        return False
    # Auto-start bundled exe if not already running
    if not flaresolverr_running():
        _log("FlareSolverr not running — starting bundled exe…")
        started = _fs_mod.ensure_running()
        if not started:
            _log("Could not start FlareSolverr.")
            return False
    with _fs_lock:
        # Prevent concurrent solves if another thread just updated the cache
        if force:
            key = _cache_key(url)
            if (time.time() - _cookie_ts.get(key, 0)) < 60:
                _log("Cache was recently updated by another thread, skipping force solve.")
                return True

        # Check if we already have valid cookies — skip solve entirely
        if not force:
            existing = _get_cached(url)
            if existing.get("cf_clearance"):
                age_h = (time.time() - _cookie_ts.get(_cache_key(url), 0)) / 3600
                _log(f"Using cached CF cookies (age: {age_h:.1f}h, valid for 7 days)")
                return True

        _log(f"Asking FlareSolverr to solve Cloudflare for {url} (this takes ~60-90s)…")

        try:
            status, html, cookies, user_agent = _fs_mod.fetch(url)
            if user_agent:
                _solved_ua = user_agent
                _log(f"Captured FlareSolverr UA: {user_agent[:80]}")
            if cookies:
                _set_cached(url, cookies)
                _log(f"CF solved! Got {len(cookies)} cookies: {list(cookies.keys())}")
                return True
            else:
                _log("FlareSolverr did not return cookies.")
                return False
        except Exception as e:
            _log(f"FlareSolverr error: {e}")
            return False

# ── curl (core request) ───────────────────────────────────────────────────────

def _curl(url: str, method: str = "GET", headers: dict = None,
          data: bytes = None, allow_redirects: bool = True) -> "CurlResponse":
    cookie_str = _build_cookie_str(url)
    agent = _solved_ua or UA

    # Use temp files to separate headers from body cleanly (avoids chunked-body corruption)
    import tempfile, os as _os
    hdr_fd, hdr_path = tempfile.mkstemp(suffix=".hdr")
    bod_fd, bod_path = tempfile.mkstemp(suffix=".body")
    _os.close(hdr_fd)
    _os.close(bod_fd)

    try:
        cmd = [
            _CURL, "-s", "-S",
            "--compressed",
            "--max-time", "30", "--connect-timeout", "15",
            "-X", method.upper(),
            "-A", agent,
            "-H", f"Cookie: {cookie_str}",
            "-H", "Accept: text/html,application/xhtml+xml,application/json,*/*;q=0.9",
            "-H", "Accept-Language: en-US,en;q=0.9",
            "-H", "Accept-Encoding: gzip, deflate",
            "-H", "Connection: keep-alive",
            "-H", "Sec-Fetch-Dest: document",
            "-H", "Sec-Fetch-Mode: navigate",
            "-H", "Sec-Fetch-Site: same-origin",
            "-D", hdr_path,
            "-o", bod_path,
        ]
        if not allow_redirects:
            cmd.append("--no-location")
        else:
            cmd += ["-L", "--max-redirs", "5"]

        if headers:
            for k, v in headers.items():
                if k.lower() != "cookie":
                    cmd += ["-H", f"{k}: {v}"]

        if data:
            cmd += ["--data-binary", "@-"]

        cmd.append(url)

        try:
            subprocess.run(cmd, input=data, capture_output=True, timeout=35)
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"curl timed out for {url}")
        except FileNotFoundError:
            raise RuntimeError("curl.exe not found — install curl and add to PATH")

        # Read headers and body from separate files
        try:
            raw_hdrs = open(hdr_path, "rb").read()
        except Exception:
            raw_hdrs = b""
        try:
            body = open(bod_path, "rb").read()
        except Exception:
            body = b""

        return _parse_curl_headers(raw_hdrs, body, url)
    finally:
        for p in (hdr_path, bod_path):
            try: _os.unlink(p)
            except: pass


# ── public request function ───────────────────────────────────────────────────

def request(
    method: str,
    url: str,
    headers: dict = None,
    data: bytes = None,
    allow_redirects: bool = True,
    use_cloudscraper: bool = False,
    use_browser: bool = False,
    browser_type: str = "chrome",
    browser_headless: bool = True,
    browser_incognito: bool = False,
    use_flaresolverr: bool = False,
    stop_flag = None,
) -> "CurlResponse":
    """
    Fast path: curl with cached cookies.
    On 403: re-solve once via FlareSolverr, retry.
    """
    if stop_flag and stop_flag():
        raise InterruptedError("Request cancelled")

    # Fast path — curl with cached cookies
    resp = _curl(url, method, headers, data, allow_redirects)
    if resp.status_code != 403:
        return resp

    if stop_flag and stop_flag():
        raise InterruptedError("Request cancelled")

    # 403 — try to re-solve
    if HAS_FLARESOLVERR and flaresolverr_running():
        log(f"CF Challenge (403) detected on {url}. Solving with FlareSolverr...")
        # FlareSolverr must visit the root domain to solve CF, not the full API endpoint
        import urllib.parse as _up
        _p = _up.urlparse(url)
        # For kwik.cx, the challenge only triggers on /f/ paths, so keep the path
        if "kwik" in (_p.hostname or ""):
            solve_url = f"{_p.scheme}://{_p.netloc}/f/invalid"
        else:
            solve_url = f"{_p.scheme}://{_p.netloc}"
        solved = solve_cf_once(url=solve_url, log_fn=log, force=True)
        if solved:
            if stop_flag and stop_flag():
                raise InterruptedError("Request cancelled")
            log("Bypass succeeded, retrying original request...")
            resp = _curl(url, method, headers, data, allow_redirects)
            if resp.status_code != 403:
                return resp

    # Cloudscraper fallback
    if use_cloudscraper and HAS_CLOUDSCRAPER:
        if stop_flag and stop_flag():
            raise InterruptedError("Request cancelled")
        log("Trying Cloudscraper fallback...")
        try:
            return _request_with_cloudscraper(method, url, headers, data, allow_redirects)
        except Exception as e:
            log(f"Cloudscraper fallback failed: {e}")

    # Browser fallback
    if use_browser and HAS_BROWSER:
        if stop_flag and stop_flag():
            raise InterruptedError("Request cancelled")
        log("Trying Browser Automation fallback...")
        try:
            return _request_with_browser(method, url, headers, data, allow_redirects,
                                         browser_type, browser_headless, browser_incognito)
        except Exception as e:
            log(f"Browser Automation fallback failed: {e}")

    return resp


# ── fallbacks ─────────────────────────────────────────────────────────────────

def _request_with_cloudscraper(method, url, headers, data, allow_redirects):
    scraper = _cslib.create_scraper(
        browser={"browser": "chrome", "platform": "windows"}, delay=3)
    req_h = {"User-Agent": UA, "Accept": "application/json, text/javascript, */*; q=0.0"}
    if headers:
        req_h.update(headers)
    if method.upper() == "POST":
        r = scraper.post(url, headers=req_h, data=data,
                         allow_redirects=allow_redirects, timeout=30)
    else:
        r = scraper.get(url, headers=req_h,
                        allow_redirects=allow_redirects, timeout=30)
    return CurlResponse(r.status_code, dict(r.headers), r.content, url)

def _request_with_browser(method, url, headers, data, allow_redirects,
                          browser_type, headless, incognito):
    html = _browser.fetch_with_browser(url, browser_type, headless, incognito,
                                       wait_for_cloudflare=True)
    return CurlResponse(200, {}, html.encode("utf-8"), url)


# ── parse curl output ─────────────────────────────────────────────────────────

def _parse_curl_headers(raw_hdrs: bytes, body: bytes, url: str = "") -> "CurlResponse":
    """Parse response headers from a curl -D dump file and a separately captured body."""
    status_code = 200
    hdrs = {}
    # The -D file may have multiple response blocks (redirects); use the last one
    blocks = re.split(rb"\r?\n\r?\n", raw_hdrs)
    last_block = b""
    for block in blocks:
        if re.search(rb"HTTP/[\d.]+", block):
            last_block = block
    if last_block:
        m = re.search(rb"HTTP/[\d.]+ (\d+)", last_block)
        if m:
            status_code = int(m.group(1))
        for line in last_block.splitlines():
            if b":" in line and not line.startswith(b"HTTP"):
                k, _, v = line.partition(b":")
                hdrs[k.strip().lower().decode(errors="replace")] = v.strip().decode(errors="replace")
    return CurlResponse(status_code, hdrs, body, url)


# kept for backward compat
def _parse_curl_output(raw: bytes, url: str = "") -> "CurlResponse":
    parts = re.split(rb"\r?\n\r?\n", raw)
    if len(parts) < 2:
        return CurlResponse(200, {}, raw, url)
    body         = parts[-1]
    last_headers = parts[-2]
    status_code  = 200
    m = re.search(rb"HTTP/[\d.]+ (\d+)", last_headers)
    if m:
        status_code = int(m.group(1))
    hdrs = {}
    for line in last_headers.splitlines():
        if b":" in line:
            k, _, v = line.partition(b":")
            hdrs[k.strip().lower().decode(errors="replace")] = v.strip().decode(errors="replace")
    return CurlResponse(status_code, hdrs, body, url)


# ── response ──────────────────────────────────────────────────────────────────

class CurlResponse:
    def __init__(self, status_code: int, headers: dict, body: bytes, url: str = ""):
        self.status_code = status_code
        self.headers     = headers
        self._body       = body
        self.url         = url

    @property
    def text(self) -> str:
        return self._body.decode("utf-8", errors="replace")

    def json(self):
        return json.loads(self._body)

    def raise_for_status(self):
        if self.status_code >= 400:
            from urllib.parse import urlparse
            host = urlparse(self.url).hostname or "server"
            raise RuntimeError(f"HTTP {self.status_code} from {host}")

    @property
    def content(self) -> bytes:
        return self._body

    @property
    def _raw_headers(self) -> str:
        return "\r\n".join(f"{k}: {v}" for k, v in self.headers.items())
