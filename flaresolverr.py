"""
flaresolverr.py — auto-manages the bundled FlareSolverr exe.

The exe lives at:  <app_dir>/flaresolverr_bin/flaresolverr.exe

On first use it is started silently in the background.
It is killed automatically when the Python process exits.
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
import atexit
import threading

FLARESOLVERR_URL = "http://localhost:8191/v1"

# Path to bundled exe (works both from source and PyInstaller)
_BASE = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
_EXE  = os.path.join(_BASE, "flaresolverr_bin", "flaresolverr.exe")

_proc:   subprocess.Popen = None
_lock    = threading.Lock()
_started = False

log_callback = None

def set_log_callback(cb):
    global log_callback
    log_callback = cb

def _log(msg: str):
    if log_callback:
        log_callback(msg)
    else:
        print(msg)


# ── process management ────────────────────────────────────────────────────────

def _kill():
    global _proc, _started
    if _proc and _proc.poll() is None:
        try:
            _proc.terminate()
            _proc.wait(timeout=5)
        except Exception:
            try:
                _proc.kill()
            except Exception:
                pass
    _proc    = None
    _started = False

atexit.register(_kill)


def _start_bundled() -> bool:
    """Start the bundled flaresolverr.exe if not already running."""
    global _proc, _started

    if not os.path.exists(_EXE):
        _log(f"Bundled FlareSolverr not found at: {_EXE}")
        return False

    with _lock:
        if _started and _proc and _proc.poll() is None:
            return True

        _log("Starting bundled FlareSolverr…")
        try:
            # Run hidden — no console window
            si = subprocess.STARTUPINFO()
            si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            si.wShowWindow = subprocess.SW_HIDE

            _proc = subprocess.Popen(
                [_EXE, "--max-timeout", "180000"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                startupinfo=si,
                cwd=os.path.dirname(_EXE),
            )
            _started = True
        except Exception as e:
            _log(f"Failed to start FlareSolverr: {e}")
            return False

    # Wait up to 15s for it to become ready
    for _ in range(30):
        time.sleep(0.5)
        if is_running():
            _log("FlareSolverr ready on :8191")
            return True

    _log("FlareSolverr did not become ready in time.")
    return False


def ensure_running() -> bool:
    """Start bundled exe if not already listening. Returns True if ready."""
    if is_running():
        return True
    return _start_bundled()


# ── public API ────────────────────────────────────────────────────────────────

def is_running() -> bool:
    try:
        urllib.request.urlopen("http://localhost:8191/", timeout=2)
        return True
    except Exception:
        return False


def fetch(url: str) -> tuple:
    """
    Fetch url via FlareSolverr (auto-starts if needed).
    Returns (status_code, html, cookies_dict, user_agent).
    """
    if not ensure_running():
        raise RuntimeError("FlareSolverr could not be started.")

    payload = json.dumps({
        "cmd": "request.get",
        "url": url,
        "maxTimeout": 180000,
    }).encode()

    req = urllib.request.Request(
        FLARESOLVERR_URL, data=payload,
        headers={"Content-Type": "application/json"},
        method="POST")

    try:
        with urllib.request.urlopen(req, timeout=210) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        try:
            msg = json.loads(body).get("message", body)
        except Exception:
            msg = body
        raise RuntimeError(f"FlareSolverr HTTP {e.code}: {msg}")
    except ConnectionRefusedError:
        raise RuntimeError("FlareSolverr is not running.")

    if data.get("status") != "ok":
        raise RuntimeError(f"FlareSolverr: {data.get('message', 'unknown error')}")

    sol     = data.get("solution", {})
    cookies = {c["name"]: c["value"] for c in sol.get("cookies", [])}
    return sol.get("status", 200), sol.get("response", ""), cookies, sol.get("userAgent", "")
