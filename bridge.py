"""
bridge.py — called by Electron via child_process.spawn.

Usage:
    python bridge.py <json_command>

Commands (json):
    {"cmd": "solve_cf"}
    {"cmd": "search",        "query": "..."}
    {"cmd": "anime_info",    "id": "..."}
    {"cmd": "metadata",      "url": "...", "is_series": true}
    {"cmd": "episode_count", "series_id": "...", "url": "..."}
    {"cmd": "episode_links", "url": "...", "start": 1, "end": 12}
    {"cmd": "pahe_win_links","play_url": "...", "res": 720, "lang": "jp"}
    {"cmd": "kwik_link",     "pahe_win_url": "..."}
    {"cmd": "download",      "url": "...", "referer": "...", "dest_dir": "...", "filename": "..."}
    {"cmd": "has_cookies"}
    {"cmd": "clear_cache"}

All output is newline-delimited JSON on stdout.
Progress lines from download use {"type":"progress",...}.
Final result uses {"type":"result",...} or {"type":"error","message":"..."}.
"""

import sys, json, os, traceback

# Make sure the script's directory is on the path so imports work
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def _ok(data):
    print(json.dumps({"type": "result", "data": data}), flush=True)

def _err(msg):
    print(json.dumps({"type": "error", "message": str(msg)}), flush=True)

def _log(msg):
    print(json.dumps({"type": "log", "message": str(msg)}), flush=True)

def main():
    if len(sys.argv) < 2:
        _err("No command provided"); return

    try:
        cmd_obj = json.loads(sys.argv[1])
    except Exception as e:
        _err(f"Invalid JSON command: {e}"); return

    cmd = cmd_obj.get("cmd", "")

    try:
        import session as _sess
        import flaresolverr as _fs
        import animepahe
        import kwik

        _sess.set_log_callback(_log)

        cf_kw = dict(use_flaresolverr=True, use_cloudscraper=False,
                     use_browser=False, browser_type="chrome",
                     browser_headless=True, browser_incognito=False)

        if cmd == "has_cookies":
            cached = _sess._get_cached("https://animepahe.pw")
            _ok({"has_cookies": bool(cached.get("cf_clearance")),
                 "age_h": ((__import__("time").time() - _sess._cookie_ts.get("animepahe", 0)) / 3600)})

        elif cmd == "clear_cache":
            _sess.clear_cache()
            _ok({"cleared": True})

        elif cmd == "solve_cf":
            _fs.ensure_running()
            ok = _sess.solve_cf_once(url="https://animepahe.pw",
                                     force=False, log_fn=_log)
            _ok({"solved": ok})

        elif cmd == "search":
            results = animepahe.search_anime(cmd_obj["query"],
                                             log=_log, **cf_kw)
            _ok(results)

        elif cmd == "anime_info":
            info = animepahe.fetch_anime_info(cmd_obj["id"],
                                              log=_log, **cf_kw)
            _ok(info)

        elif cmd == "metadata":
            meta = animepahe.fetch_metadata(
                cmd_obj["url"], cmd_obj.get("is_series", True),
                log=_log, **cf_kw)
            _ok(meta)

        elif cmd == "episode_count":
            total = animepahe.get_episode_count(
                cmd_obj["series_id"], cmd_obj["url"], **cf_kw)
            _ok({"total": total})

        elif cmd == "episode_links":
            links = animepahe.fetch_series_episode_links(
                cmd_obj["url"],
                (cmd_obj["start"], cmd_obj["end"]),
                log=_log, **cf_kw)
            _ok(links)

        elif cmd == "pahe_win_links":
            result = animepahe.fetch_pahe_win_links(
                cmd_obj["play_url"],
                cmd_obj.get("res", 720),
                cmd_obj.get("lang", "jp"),
                **cf_kw)
            _ok(result)

        elif cmd == "kwik_link":
            result = kwik.extract_kwik_link(cmd_obj["pahe_win_url"])
            _ok(result)

        elif cmd == "download":
            import downloader as _dl

            def on_prog(done, total, speed, eta):
                print(json.dumps({
                    "type": "progress",
                    "downloaded": done,
                    "total": total,
                    "speed": speed,
                    "eta": eta
                }), flush=True)

            path = _dl.download(
                url=cmd_obj["url"],
                referer=cmd_obj["referer"],
                dest_dir=cmd_obj["dest_dir"],
                filename=cmd_obj.get("filename", ""),
                on_progress=on_prog,
            )
            _ok({"path": path})

        else:
            _err(f"Unknown command: {cmd}")

    except Exception as e:
        _err(f"{cmd} failed: {e}\n{traceback.format_exc()}")

if __name__ == "__main__":
    main()
