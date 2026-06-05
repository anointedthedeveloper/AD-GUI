import re
import html as _html
import session as _sess

# API calls and page requests go to .pw (unified to prevent CF bypass mismatch)
# session.py handles Cloudflare bypass (FlareSolverr, cloudscraper, browser)
API_BASE  = "https://animepahe.pw"
PAGE_BASE = "https://animepahe.pw"

SERIES_URL_RE = re.compile(
    r"^https://animepahe\.(com|org|ru|si|pw)/anime/[a-f0-9\-]{36}$"
)
EPISODE_URL_RE = re.compile(
    r"^https://animepahe\.(com|org|ru|si|pw)/play/[a-f0-9\-]{36}/[a-f0-9]{64}$"
)


def _unescape(t: str) -> str:
    return _html.unescape(t)


def _norm_page(url: str) -> str:
    """Normalise any animepahe domain to PAGE_BASE for page requests."""
    return re.sub(r"https://animepahe\.(com|org|ru|si|pw)", PAGE_BASE, url)


def _get(url: str, referer: str = None,
         use_cloudscraper: bool = False,
         use_browser: bool = False, browser_type: str = "chrome",
         browser_headless: bool = True, browser_incognito: bool = False,
         use_flaresolverr: bool = False, stop_flag=None):
    return _sess.request(
        "GET", url,
        headers={"Referer": referer or url},
        use_cloudscraper=use_cloudscraper,
        use_browser=use_browser,
        browser_type=browser_type,
        browser_headless=browser_headless,
        browser_incognito=browser_incognito,
        use_flaresolverr=use_flaresolverr,
        stop_flag=stop_flag,
    )


# ── CF bypass kwargs helper ───────────────────────────────────────────────────

def _cf(**kw):
    """Extract CF bypass kwargs from a dict, with safe defaults."""
    return {
        "use_cloudscraper":  kw.get("use_cloudscraper",  False),
        "use_browser":       kw.get("use_browser",       False),
        "browser_type":      kw.get("browser_type",      "chrome"),
        "browser_headless":  kw.get("browser_headless",  True),
        "browser_incognito": kw.get("browser_incognito", False),
        "use_flaresolverr":  kw.get("use_flaresolverr",  False),
        "stop_flag":         kw.get("stop_flag",         None),
    }


# ── API-based functions ───────────────────────────────────────────────────────

def search_anime(query: str, log=print, **cf_kw) -> list:
    log(f"Searching for: {query}")
    r = _get(f"{API_BASE}/api?m=search&q={query}", referer=PAGE_BASE, **_cf(**cf_kw))
    r.raise_for_status()
    return r.json().get("data", [])


def fetch_anime_info(anime_id: str, log=print, **cf_kw) -> dict:
    r = _get(f"{API_BASE}/api?m=anime&id={anime_id}", referer=PAGE_BASE, **_cf(**cf_kw))
    r.raise_for_status()
    return r.json()


def fetch_poster(anime_id: str, **cf_kw) -> str:
    try:
        return fetch_anime_info(anime_id, **cf_kw).get("poster", "")
    except Exception:
        return ""


# ── URL helpers ───────────────────────────────────────────────────────────────

def is_series_url(url: str) -> bool:
    return bool(SERIES_URL_RE.match(url))

def is_episode_url(url: str) -> bool:
    return bool(EPISODE_URL_RE.match(url))

def get_series_id(url: str) -> str:
    m = re.search(r"anime/([a-f0-9\-]{36})", url)
    if not m:
        raise ValueError(f"Cannot extract series ID from: {url}")
    return m.group(1)


# ── metadata ──────────────────────────────────────────────────────────────────

def fetch_metadata(url: str, is_series: bool, log=print,
                   use_cloudscraper: bool = False,
                   use_browser: bool = False, browser_type: str = "chrome",
                   browser_headless: bool = True, browser_incognito: bool = False,
                   use_flaresolverr: bool = False, stop_flag=None) -> dict:

    cf_kw = dict(use_cloudscraper=use_cloudscraper, use_browser=use_browser,
                 browser_type=browser_type, browser_headless=browser_headless,
                 browser_incognito=browser_incognito, use_flaresolverr=use_flaresolverr,
                 stop_flag=stop_flag)

    series_id = get_series_id(url) if is_series_url(url) else None
    if series_id:
        try:
            info = fetch_anime_info(series_id, log, **cf_kw)
            return {
                "title":         info.get("title", ""),
                "type":          info.get("type", ""),
                "episode_count": info.get("episodes", ""),
                "poster":        info.get("poster", ""),
                "session":       info.get("session", ""),
                "id":            series_id,
            }
        except Exception as e:
            log(f"API metadata failed: {e}, falling back to scraping")

    # Scrape fallback
    url  = _norm_page(url)
    log("Fetching metadata via scraping…")
    r    = _get(url, referer=PAGE_BASE, **cf_kw)
    r.raise_for_status()
    text = r.text.replace("\r\n", "").replace("\n", "").replace("\r", "")

    if is_series:
        title = ep_count = anime_type = poster = ""
        m = re.search(r'style=[^=]+title="([^"]+)"', text)
        if m: title = _unescape(m.group(1))
        m = re.search(r'Type:[^>]*title="[^"]*"[^>]*>([^<]+)</a>', text)
        if m: anime_type = _unescape(m.group(1))
        m = re.search(r'Episode[^>]*>\s*(\S*)</p', text)
        if m: ep_count = _unescape(m.group(1))
        m = re.search(r'(https://i\.animepahe\.pw/posters/[^"]+)', text)
        if m: poster = m.group(1)
        return {"title": title, "type": anime_type, "episode_count": ep_count, "poster": poster}
    else:
        title = episode = poster = ""
        m = re.search(r'title="[^>]*>([^<]*)</a>\D*(\d*)<span', text)
        if m:
            title   = _unescape(m.group(1))
            episode = _unescape(m.group(2))
        m = re.search(r'(https://i\.animepahe\.pw/posters/[^"]+)', text)
        if m: poster = m.group(1)
        return {"title": title, "episode": episode, "poster": poster}


def get_episode_count(series_id: str, url: str,
                      use_cloudscraper: bool = False,
                      use_browser: bool = False, browser_type: str = "chrome",
                      browser_headless: bool = True, browser_incognito: bool = False,
                      use_flaresolverr: bool = False, stop_flag=None) -> int:
    cf_kw = dict(use_cloudscraper=use_cloudscraper, use_browser=use_browser,
                 browser_type=browser_type, browser_headless=browser_headless,
                 browser_incognito=browser_incognito, use_flaresolverr=use_flaresolverr,
                 stop_flag=stop_flag)
    r = _get(
        f"{API_BASE}/api?m=release&id={series_id}&sort=episode_asc&page=1",
        referer=_norm_page(url), **cf_kw,
    )
    r.raise_for_status()
    return r.json().get("total", 0)


def _get_page(n: int) -> int:
    return max(1, (n + 29) // 30)


def fetch_series_episode_links(url: str, ep_range: tuple, log=print,
                               use_cloudscraper: bool = False,
                               use_browser: bool = False, browser_type: str = "chrome",
                               browser_headless: bool = True, browser_incognito: bool = False,
                               use_flaresolverr: bool = False, stop_flag=None) -> list:
    cf_kw     = dict(use_cloudscraper=use_cloudscraper, use_browser=use_browser,
                     browser_type=browser_type, browser_headless=browser_headless,
                     browser_incognito=browser_incognito, use_flaresolverr=use_flaresolverr,
                     stop_flag=stop_flag)
    page_url  = _norm_page(url)
    series_id = get_series_id(page_url)
    total     = get_episode_count(series_id, page_url, **cf_kw)
    start, end = ep_range

    if start > total or end > total:
        raise ValueError(f"Episode range {start}-{end} out of bounds (total: {total})")

    links = []
    for page in range(_get_page(start), _get_page(end) + 1):
        log(f"Fetching page {page}…")
        r = _get(
            f"{API_BASE}/api?m=release&id={series_id}&sort=episode_asc&page={page}",
            referer=page_url, **cf_kw,
        )
        r.raise_for_status()
        for ep in r.json().get("data", []):
            links.append(f"{PAGE_BASE}/play/{series_id}/{ep.get('session', '')}")

    offset = (_get_page(start) - 1) * 30
    return [lnk for i, lnk in enumerate(links) if start <= offset + i + 1 <= end]


def fetch_pahe_win_links(play_url: str, target_res: int, audio_lang: str,
                         use_cloudscraper: bool = False,
                         use_browser: bool = False, browser_type: str = "chrome",
                         browser_headless: bool = True, browser_incognito: bool = False,
                         use_flaresolverr: bool = False, stop_flag=None) -> dict:
    cf_kw    = dict(use_cloudscraper=use_cloudscraper, use_browser=use_browser,
                    browser_type=browser_type, browser_headless=browser_headless,
                    browser_incognito=browser_incognito, use_flaresolverr=use_flaresolverr,
                    stop_flag=stop_flag)
    play_url = _norm_page(play_url)
    r        = _get(play_url, referer=PAGE_BASE, **cf_kw)
    r.raise_for_status()
    text = r.text.replace("\r\n", "").replace("\n", "").replace("\r", "")

    candidates = []

    # ── Attempt 1: JSON in <script> tag: let links = {...} ────────────────────
    # AnimePahe embeds download links as JSON in a script tag like:
    # let links = {"1":{"720":{"kwik":"https://kwik.cx/e/...","kwik_pahewin":"https://pahe.win/..."},...}}
    m_json = re.search(r'let\s+links\s*=\s*(\{.*?\})\s*;?\s*(?:let|var|const|</)', text)
    if m_json:
        try:
            import json as _json
            links_json = _json.loads(m_json.group(1))
            for ep_key, resolutions in links_json.items():
                for res_str, sources in resolutions.items():
                    if isinstance(sources, dict):
                        pahe_win = sources.get("kwik_pahewin") or sources.get("kwik")
                        lang     = sources.get("audio", "jpn")
                        # normalise language code
                        if "eng" in lang.lower() or lang.lower() in ("en", "dub"):
                            lang = "en"
                        elif "chi" in lang.lower() or lang.lower() in ("zh",):
                            lang = "zh"
                        else:
                            lang = "jp"
                        try:
                            res = int(re.search(r'\d+', res_str).group())
                        except Exception:
                            res = 0
                        if pahe_win:
                            candidates.append({"dPaheLink": pahe_win, "epRes": res, "epLang": lang})
        except Exception:
            pass

    # ── Attempt 2: <a href="https://pahe.win/..."> anchor tags ──────────────
    if not candidates:
        for m in re.finditer(r'<a href="(https?://pahe\.win/\S*)"[^>]*>(.*?)</a>', text):
            d_link = _unescape(m.group(1))
            block  = m.group(2)
            res_m  = re.search(r'\b(\d{3,4})p\b', block)
            res    = int(res_m.group(1)) if res_m else 0
            lang   = "jp"
            for span in re.findall(r'<span[^>]*>([^<]*)</span>', block):
                s = span.strip().lower()
                if s == "dub":            lang = "en"; break
                elif s == "chi":          lang = "zh"; break
                elif s not in ("bd", ""): lang = s;    break
            candidates.append({"dPaheLink": d_link, "epRes": res, "epLang": lang})

    # ── Attempt 3: kwik.cx links directly in page ─────────────────────────────
    if not candidates:
        for m in re.finditer(r'href="(https?://kwik\.cx/e/[^"]+)"', text):
            candidates.append({"dPaheLink": m.group(1), "epRes": 0, "epLang": "jp"})

    if not candidates:
        raise RuntimeError(f"No download links found on {play_url}")

    filtered = [c for c in candidates if c["epLang"] == audio_lang] or candidates

    if target_res == 0:    return max(filtered, key=lambda x: x["epRes"])
    elif target_res == -1: return min(filtered, key=lambda x: x["epRes"])
    else:
        exact = next((c for c in filtered if c["epRes"] == target_res), None)
        return exact or max(filtered, key=lambda x: x["epRes"])

