import re
import math
import subprocess
import sys
import session as _sess

# On Windows PowerShell, 'curl' is an alias for Invoke-WebRequest.
_CURL = "curl.exe" if sys.platform == "win32" else "curl"

BASE_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/138.0.0.0 Safari/537.36"
)


def _base_convert(s: str, from_base: int) -> int:
    h = BASE_ALPHABET[:from_base]
    j = 0
    for idx, ch in enumerate(reversed(s)):
        pos = h.find(ch)
        if pos != -1:
            j += pos * int(math.pow(from_base, idx))
    return j


def _decode_js(encoded: str, alphabet: str, offset: int, base: int) -> str:
    """Matches CLI decodeJSStyle exactly."""
    result, i = [], 0
    while i < len(encoded):
        s = ""
        while i < len(encoded) and encoded[i] != alphabet[base]:
            s += encoded[i]
            i += 1
        for j, ch in enumerate(alphabet):
            s = s.replace(ch, str(j))
        result.append(chr(_base_convert(s, base) - offset))
        i += 1
    return "".join(result)


def _extract_params(text: str):
    m = re.search(
        r'\(\s*"([^",]*)"\s*,\s*\d+\s*,\s*"([^",]*)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*\d+[a-zA-Z]?\s*\)',
        text,
    )
    return (m.group(1), m.group(2), int(m.group(3)), int(m.group(4))) if m else None


def _curl_post_no_redirect(url: str, token: str, referer: str, cookie: str) -> str:
    """
    POST _token=<token> to url, with redirects disabled.
    Returns the Location header value on 302.
    Mirrors CLI's fetch_kwik_direct exactly.
    """
    cmd = [
        _CURL, "-s", "-S",
        "--max-time", "20",
        "--connect-timeout", "15",
        "-X", "POST",
        "-A", UA,
        "-H", f"Referer: {referer}",
        "-H", f"Cookie: {cookie}",
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "--data-raw", f"_token={token}",
        "--no-location",          # do NOT follow redirects
        "-D", "-",                # dump headers to stdout
        "-o", "/dev/null",        # discard body
        url,
    ]
    # On Windows /dev/null doesn't exist — use nul
    import os
    if os.name == "nt":
        cmd[cmd.index("-o") + 1] = "nul"

    try:
        result = subprocess.run(cmd, capture_output=True, timeout=25)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"curl POST timed out for {url}")
    except FileNotFoundError:
        raise RuntimeError("curl not found")

    raw = result.stdout.decode("utf-8", errors="replace")

    # Check status
    status_m = re.search(r"HTTP/[\d.]+ (\d+)", raw)
    status   = int(status_m.group(1)) if status_m else 0

    if status == 302:
        loc_m = re.search(r"[Ll]ocation:\s*(https?://\S+)", raw)
        if loc_m:
            return loc_m.group(1).strip()

    raise RuntimeError(f"Expected 302 redirect from {url}, got {status}")


def _fetch_kwik_dlink(kwik_link: str, referer: str, retries: int = 5) -> str:
    if retries <= 0:
        raise RuntimeError(f"Exceeded retry limit for kwik: {kwik_link}")

    resp = _sess.request("GET", kwik_link, headers={"Referer": referer})
    if resp.status_code != 200:
        raise RuntimeError(f"GET {kwik_link} → {resp.status_code}")

    text = resp.text.replace("\r\n", "").replace("\n", "").replace("\r", "")

    # Extract kwik_session from response headers (matches CLI)
    kwik_session = ""
    raw_hdrs = resp._raw_headers
    m = re.search(r"kwik_session=([^;\s]*)", raw_hdrs)
    if m:
        kwik_session = m.group(1)

    params = _extract_params(text)
    if not params:
        return _fetch_kwik_dlink(kwik_link, referer, retries - 1)

    encoded, alphabet, offset, base = params
    if not encoded or not alphabet:
        return _fetch_kwik_dlink(kwik_link, referer, retries - 1)

    try:
        decoded = _decode_js(encoded, alphabet, offset, base)

        # Extract the POST url (kwik /f/ link)
        link_m = re.search(r'"(https?://kwik\.[^/\s"]+/[^/\s"]+/[^"\s]*)"', decoded)

        # CLI token regex: name="_token"[^"]*"(\S*)">
        token_m = re.search(r'name="_token"[^"]*"(\S*)">', decoded)
        if not token_m:
            # fallback patterns
            token_m = (
                re.search(r'name=["\']_token["\'][^>]*value=["\']([^"\']+)["\']', decoded)
                or re.search(r'value=["\']([^"\']+)["\'][^>]*name=["\']_token["\']', decoded)
            )

        if not link_m or not token_m:
            return _fetch_kwik_dlink(kwik_link, referer, retries - 1)

        post_url  = link_m.group(1)
        token_val = token_m.group(1)

        # Build cookie: CF cookies for kwik.cx + kwik_session (matches CLI)
        cf_cookies = _sess._cookie_str_for(post_url)
        full_cookie = cf_cookies + (f"; kwik_session={kwik_session}" if kwik_session else "")

        return _curl_post_no_redirect(post_url, token_val, kwik_link, full_cookie)

    except RuntimeError:
        raise
    except Exception:
        return _fetch_kwik_dlink(kwik_link, referer, retries - 1)


def extract_kwik_link(pahe_win_url: str) -> dict:
    resp = _sess.request("GET", pahe_win_url)
    if resp.status_code != 200:
        raise RuntimeError(f"GET {pahe_win_url} → {resp.status_code}")

    text = resp.text.replace("\r\n", "").replace("\n", "").replace("\r", "")

    kwik_link = ""

    # attempt 1 — direct kwik link in page
    m = re.search(r'"(https?://kwik\.[^/\s"]+/[^/\s"]+/[^"\s]*)"', text)
    if m:
        kwik_link = m.group(1)

    # attempt 2 — decode obfuscated JS (matches CLI second attempt)
    if not kwik_link:
        params = _extract_params(text)
        if not params:
            raise RuntimeError(f"Cannot extract kwik params from {pahe_win_url}")
        encoded, alphabet, offset, base = params
        decoded = _decode_js(encoded, alphabet, offset, base)
        m2 = re.search(r'"(https?://kwik\.[^/\s"]+/[^/\s"]+/[^"\s]*)"', decoded)
        if not m2:
            raise RuntimeError("Cannot find kwik link in decoded JS")
        # Replace /d/ with /f/ — matches CLI: RE2::Replace(&kwikLink, .../d/... , /f/)
        kwik_link = re.sub(r"(https://kwik\.[^/]+/)d/", r"\1f/", m2.group(1))

    direct = _fetch_kwik_dlink(kwik_link, pahe_win_url)
    return {"directLink": direct, "referer": kwik_link}
