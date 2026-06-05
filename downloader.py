import os
import re
import time
import subprocess
import threading
import session as _sess

CHUNK   = 1024 * 64   # progress poll chunk size (bytes) — not used for writing
MAX_RETRIES = 5
BACKOFF     = [1, 2, 4, 8, 16]

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/138.0.0.0 Safari/537.36"
)


def _filename_from_url(url: str, fallback: str) -> str:
    from urllib.parse import urlparse, parse_qs
    qs = parse_qs(urlparse(url).query)
    if "file" in qs:
        return qs["file"][0]
    seg = urlparse(url).path.rstrip("/").split("/")[-1]
    if seg and "." in seg:
        return seg
    return fallback


def download(
    url: str,
    referer: str,
    dest_dir: str,
    filename: str = "",
    on_progress=None,   # callable(downloaded_bytes, total_bytes, speed_bps, eta_s)
    stop_flag=None,     # callable() → bool
) -> str:
    """
    Downloads url into dest_dir/filename using curl streamed directly to disk.
    Supports resume via Range header.  Returns the final file path.
    """
    os.makedirs(dest_dir, exist_ok=True)

    if not filename:
        filename = _filename_from_url(url, f"download_{int(time.time())}.mp4")

    filepath = os.path.join(dest_dir, filename)
    tmp_path = filepath + ".part"

    cookie_str = _sess._cookie_str_for(url)

    for attempt in range(MAX_RETRIES):
        if stop_flag and stop_flag():
            raise InterruptedError("Download cancelled")

        existing = os.path.getsize(tmp_path) if os.path.exists(tmp_path) else 0

        # Try to retrieve Content-Length from HEAD request
        total = 0
        try:
            head_cmd = [
                "curl", "-sI",
                "-L", "--max-redirs", "5",
                "-A", UA,
                "-H", f"Referer: {referer}",
                "-H", f"Cookie: {cookie_str}",
                url
            ]
            h_res = subprocess.run(head_cmd, capture_output=True, timeout=15)
            h_out = h_res.stdout.decode("utf-8", errors="replace").lower()
            m_cl = re.search(r"content-length:\s*(\d+)", h_out)
            if m_cl:
                total = int(m_cl.group(1))
        except Exception:
            pass

        # ── build curl command ────────────────────────────────────────────────
        cmd = [
            "curl", "-S", "--fail-with-body",
            "--max-time", "0",           # no timeout — file can be large
            "--connect-timeout", "20",
            "-L", "--max-redirs", "5",
            "-A", UA,
            "-H", f"Referer: {referer}",
            "-H", f"Cookie: {cookie_str}",
            "-H", "Accept: */*",
            "-H", "Accept-Language: en-US,en;q=0.9",
            "-o", tmp_path,
        ]

        if existing > 0:
            cmd += ["-C", str(existing)]   # resume from byte offset

        cmd.append(url)

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
        except FileNotFoundError:
            raise RuntimeError("curl not found — please install curl and add it to PATH")

        # ── poll file size for progress ───────────────────────────────────────
        start_time = time.monotonic()
        last_size  = existing

        while proc.poll() is None:
            if stop_flag and stop_flag():
                proc.terminate()
                raise InterruptedError("Download cancelled")

            time.sleep(0.5)

            try:
                current = os.path.getsize(tmp_path) if os.path.exists(tmp_path) else 0
            except OSError:
                current = last_size

            total_for_cb = total if total > 0 else current

            if on_progress and current > 0:
                elapsed = time.monotonic() - start_time
                delta   = current - existing
                speed   = delta / elapsed if elapsed > 0 else 0
                eta = (total_for_cb - current) / speed if (speed > 0 and total_for_cb > current) else 0
                on_progress(current, total_for_cb, speed, eta)

            last_size = current

        # ── curl finished ─────────────────────────────────────────────────────
        returncode = proc.wait()
        stderr_out = proc.stderr.read().decode("utf-8", errors="replace")

        if stop_flag and stop_flag():
            raise InterruptedError("Download cancelled")

        # curl exit 22 = HTTP error, exit 33 = range not satisfiable (already done)
        if returncode == 33:
            # file already complete
            if os.path.exists(tmp_path):
                os.replace(tmp_path, filepath)
            return filepath

        if returncode != 0:
            if attempt < MAX_RETRIES - 1:
                time.sleep(BACKOFF[attempt])
                continue
            raise RuntimeError(
                f"curl failed (exit {returncode}) after {MAX_RETRIES} attempts.\n{stderr_out.strip()}"
            )

        # success
        final_size = os.path.getsize(tmp_path) if os.path.exists(tmp_path) else 0
        if on_progress and final_size > 0:
            on_progress(final_size, final_size, 0, 0)

        os.replace(tmp_path, filepath)
        return filepath

    raise RuntimeError("Download failed after all retries")
