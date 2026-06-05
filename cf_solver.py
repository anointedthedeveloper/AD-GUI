"""
cf_solver.py — Cloudflare bypass using undetected-chromedriver.
...
"""

import os
import time
import json

try:
    import undetected_chromedriver as uc
    HAS_UC = True
except ImportError:
    HAS_UC = False

_cached_cookies: dict = {}   # domain -> {name: value}
_last_solved:    dict = {}   # domain -> timestamp


def is_available() -> bool:
    return HAS_UC


def _needs_refresh(domain: str, max_age: int = 3600) -> bool:
    """Return True if we need to re-solve CF for this domain."""
    if domain not in _last_solved:
        return True
    return (time.time() - _last_solved[domain]) > max_age


def _get_chrome_major_version() -> int:
    """Detect the installed Chrome major version."""
    import subprocess, re
    paths = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Users\{}\AppData\Local\Google\Chrome\Application\chrome.exe".format(
            os.environ.get("USERNAME", "")),
    ]
    for path in paths:
        if os.path.exists(path):
            try:
                r = subprocess.run([path, "--version"], capture_output=True, timeout=5)
                m = re.search(r"(\d+)\.", r.stdout.decode())
                if m:
                    return int(m.group(1))
            except Exception:
                pass
    return None  # let uc auto-detect


def solve(url: str, headless: bool = True, timeout: int = 45) -> dict:
    """
    Visit url with undetected Chrome, solve CF challenge, return cookies dict.
    Tries headless first; if CF blocks it, retries with visible window.
    Caches cookies per domain for 1 hour.
    """
    if not HAS_UC:
        raise RuntimeError(
            "undetected-chromedriver not installed.\n"
            "Run:  pip install undetected-chromedriver"
        )

    from urllib.parse import urlparse
    domain = urlparse(url).hostname or url

    # Return cached if still fresh
    if not _needs_refresh(domain) and domain in _cached_cookies:
        return _cached_cookies[domain]

    # Try headless first, fall back to visible if CF blocks it
    for try_headless in ([True, False] if headless else [False]):
        cookies = _try_solve(url, try_headless, timeout)
        if cookies.get("cf_clearance"):
            _cached_cookies[domain] = cookies
            _last_solved[domain]    = time.time()
            return cookies

    # Return whatever cookies we got (may be empty)
    _cached_cookies[domain] = cookies
    _last_solved[domain]    = time.time()
    return cookies


def _try_solve(url: str, headless: bool, timeout: int) -> dict:
    """Single attempt to solve CF with given headless setting."""
    options = uc.ChromeOptions()
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1280,800")
    options.add_argument("--disable-blink-features=AutomationControlled")

    driver = None
    try:
        chrome_ver = _get_chrome_major_version() or 148
        driver = uc.Chrome(options=options, use_subprocess=True, version_main=chrome_ver)
        driver.set_page_load_timeout(timeout + 30)

        driver.get(url)

        # Wait for CF challenge to clear
        deadline = time.time() + timeout
        while time.time() < deadline:
            title = driver.title.lower()
            if "just a moment" not in title and "cloudflare" not in title:
                break
            time.sleep(1)

        time.sleep(2)  # let cookies settle

        raw = driver.get_cookies()
        return {c["name"]: c["value"] for c in raw}

    except Exception:
        return {}
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass


def get_cookie_str(url: str, headless: bool = True) -> str:
    """
    Solve CF for url and return a cookie header string.
    Returns empty string if undetected-chromedriver is not installed.
    """
    if not HAS_UC:
        return ""
    try:
        cookies = solve(url, headless=headless)
        return "; ".join(f"{k}={v}" for k, v in cookies.items())
    except Exception:
        return ""


def invalidate(domain: str = None):
    """Clear cached cookies (force re-solve on next request)."""
    global _cached_cookies, _last_solved
    if domain:
        _cached_cookies.pop(domain, None)
        _last_solved.pop(domain, None)
    else:
        _cached_cookies.clear()
        _last_solved.clear()
