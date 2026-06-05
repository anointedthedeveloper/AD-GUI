import os
import re
import time
import threading
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

import animepahe
import kwik
import downloader
import session as _sess
import flaresolverr as _flaresolverr

# ── helpers ────────────────────────────────────────────────────────────────────

def _get_play_ids(url):
    m = re.search(r"play/([a-f0-9\-]{36})/([a-f0-9]{64})", url)
    if not m:
        raise ValueError(f"Cannot extract play IDs from: {url}")
    return m.group(1), m.group(2)

def _fmt_size(b):
    for u in ("B","KB","MB","GB"):
        if b < 1024: return f"{b:.1f} {u}"
        b /= 1024
    return f"{b:.1f} TB"

def _fmt_time(s):
    s = int(s)
    h, s = divmod(s, 3600)
    m, s = divmod(s, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"

def _sanitize(name):
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).rstrip(" .") or "_"

def _parse_range(ep_str, total):
    ep_str = ep_str.strip()
    if ep_str.lower() == "all": return 1, total
    if re.fullmatch(r"\d+", ep_str): n = int(ep_str); return n, n
    m = re.fullmatch(r"(\d+)-(\d+)", ep_str)
    if m: return int(m.group(1)), int(m.group(2))
    raise ValueError(f"Invalid range '{ep_str}'")

def _is_valid_video(path):
    if not os.path.exists(path) or os.path.getsize(path) < 10*1024*1024:
        return False
    try:
        import subprocess
        r = subprocess.run(
            ["ffprobe","-v","error","-select_streams","v:0",
             "-show_entries","stream=codec_type","-of","default=noprint_wrappers=1",path],
            capture_output=True, timeout=15)
        return r.returncode == 0
    except Exception:
        return True

def _find_existing_ep(dest_dir, ep_num):
    import glob
    try: n = int(float(ep_num))
    except: return ""
    for pat in (f"*{n:03d}*", f"*{n:02d}*", f"*- {n} *"):
        for ext in (".mp4",".mkv",".webm"):
            hits = glob.glob(os.path.join(dest_dir, pat+ext))
            if hits: return hits[0]
    return ""

BATCH = 50

# ── themes ─────────────────────────────────────────────────────────────────────

LIGHT = {
    "BG":       "#f0f4ff",
    "CARD":     "#ffffff",
    "PANEL":    "#f8faff",
    "BORDER":   "#dbe4ff",
    "ACCENT":   "#2563eb",
    "ACCENT2":  "#1d4ed8",
    "SUCCESS":  "#16a34a",
    "DANGER":   "#dc2626",
    "WARNING":  "#d97706",
    "TEXT":     "#0f172a",
    "SUBTEXT":  "#64748b",
    "MUTED":    "#94a3b8",
    "TERM_BG":  "#f1f5ff",
    "TERM_FG":  "#1e3a5f",
    "ROW_ALT":  "#f0f4ff",
    "HDR_BTN":  "#e0e7ff",
    "CHK_BG":   "#ffffff",
    "SEL_BG":   "#dbeafe",
}

DARK = {
    "BG":       "#0f172a",
    "CARD":     "#1e293b",
    "PANEL":    "#0f172a",
    "BORDER":   "#334155",
    "ACCENT":   "#3b82f6",
    "ACCENT2":  "#2563eb",
    "SUCCESS":  "#22c55e",
    "DANGER":   "#ef4444",
    "WARNING":  "#f59e0b",
    "TEXT":     "#f1f5f9",
    "SUBTEXT":  "#94a3b8",
    "MUTED":    "#64748b",
    "TERM_BG":  "#0f172a",
    "TERM_FG":  "#93c5fd",
    "ROW_ALT":  "#1e293b",
    "HDR_BTN":  "#334155",
    "CHK_BG":   "#1e293b",
    "SEL_BG":   "#1e3a5f",
}

F       = ("Segoe UI", 10)
F_SM    = ("Segoe UI", 9)
F_BOLD  = ("Segoe UI", 10, "bold")
F_MONO  = ("Consolas", 9)
F_TITLE = ("Segoe UI", 28, "bold")
F_LG    = ("Segoe UI", 18, "bold")
F_MD    = ("Segoe UI", 13, "bold")

# ── widget helpers ─────────────────────────────────────────────────────────────

def btn(parent, text, cmd, bg, fg="white", font=F_SM, px=14, py=7, **kw):
    b = tk.Button(parent, text=text, command=cmd, bg=bg, fg=fg,
                  activebackground=bg, activeforeground=fg,
                  relief="flat", font=font, cursor="hand2",
                  bd=0, padx=px, pady=py, **kw)
    return b

def entry(parent, var, t, **kw):
    return tk.Entry(parent, textvariable=var, bg=t["PANEL"], fg=t["TEXT"],
                    insertbackground=t["ACCENT"], relief="flat", font=F,
                    highlightthickness=1, highlightbackground=t["BORDER"],
                    highlightcolor=t["ACCENT"], **kw)

def card(parent, t, **kw):
    return tk.Frame(parent, bg=t["CARD"], **kw)

def sep(parent, t):
    return tk.Frame(parent, bg=t["BORDER"], height=1)

def loading_spinner(parent, t):
    """Create a simple loading spinner label"""
    lbl = tk.Label(parent, text="⏳", bg=t["CARD"], fg=t["ACCENT"],
                   font=("Segoe UI", 16))
    return lbl


# ══════════════════════════════════════════════════════════════════════════════
#  App
# ══════════════════════════════════════════════════════════════════════════════

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self._t = LIGHT          # default theme = white/blue
        self.title("Anime Downloader")
        self.configure(bg=LIGHT["BG"])
        self.minsize(960, 640)
        self.resizable(True, True)

        self._ico = os.path.join(os.path.dirname(os.path.abspath(__file__)), "appico.ico")
        self._stop        = threading.Event()
        self._stop_fetch  = threading.Event()

        # CF / settings state
        self._bypass   = "flaresolverr"
        self._max_dl   = 3
        self._dir      = tk.StringVar(value=os.path.expanduser("~/Downloads"))

        # download page state
        self._ep_vars   = []   # (BooleanVar, label, play_url, ep_num)
        self._ep_data   = []
        self._series_id = ""
        self._series_title = ""
        self._thumbs    = {}
        self._total_eps = 0
        self._fetched_to = 0
        self._current_url = ""
        self._current_page = "home"  # track active page for theme restore

        # download queue: list of dicts {title, url, ep_vars, series_title}
        self._queue     = []

        # search debounce
        self._search_after = None

        _sess.set_log_callback(self._log_dim)
        self._apply_style()
        self._build()
        self.after(0, lambda: self.state("zoomed"))
        self.after(200, self._set_icon)
        threading.Thread(target=self._boot_cf, daemon=True).start()

    # ── boot ──────────────────────────────────────────────────────────────────

    def _boot_cf(self):
        cached = _sess._get_cached("https://animepahe.pw")
        if cached.get("cf_clearance"):
            age = (time.time() - _sess._cookie_ts.get("animepahe", 0)) / 3600
            self._log_dim(f"CF cookies valid (age {age:.1f}h) — ready.")
            return
        self._log_dim("Starting FlareSolverr…")
        try:
            _flaresolverr.ensure_running()
            _sess.solve_cf_once(url="https://animepahe.pw",
                                force=False, log_fn=self._log_dim)
        except Exception as e:
            self._log_err(f"CF boot failed: {e}")

    def _set_icon(self):
        if os.path.exists(self._ico):
            try: self.iconbitmap(self._ico)
            except: pass

    def _apply_style(self):
        t = self._t
        s = ttk.Style(); s.theme_use("clam")
        for name, c in (("A.Horizontal.TProgressbar", t["ACCENT"]),
                        ("S.Horizontal.TProgressbar", t["SUCCESS"])):
            s.configure(name, troughcolor=t["PANEL"], background=c,
                        troughrelief="flat", relief="flat", borderwidth=0,
                        lightcolor=c, darkcolor=c)
        s.configure("TCombobox",
            fieldbackground=t["CARD"], background=t["CARD"],
            foreground=t["TEXT"], selectbackground=t["ACCENT"],
            selectforeground="white", arrowcolor=t["SUBTEXT"],
            borderwidth=0, relief="flat", padding=4)
        s.map("TCombobox",
            fieldbackground=[("readonly", t["CARD"])],
            foreground=[("readonly", t["TEXT"])])
        s.configure("Vertical.TScrollbar",
            background=t["BORDER"], troughcolor=t["BG"],
            bordercolor=t["BG"], arrowcolor=t["MUTED"],
            relief="flat", width=7)

    # ── build (two frames, one visible at a time) ─────────────────────────────

    def _build(self):
        self.grid_rowconfigure(0, weight=1)
        self.grid_columnconfigure(0, weight=1)

        self._page_home  = tk.Frame(self, bg=self._t["BG"])
        self._page_dl    = tk.Frame(self, bg=self._t["BG"])
        self._page_queue = tk.Frame(self, bg=self._t["BG"])

        for f in (self._page_home, self._page_dl, self._page_queue):
            f.grid(row=0, column=0, sticky="nsew")

        self._build_home(self._page_home)
        self._build_dl(self._page_dl)
        self._build_queue(self._page_queue)
        self._show_home()

    def _show_home(self):
        self._current_page = "home"
        self._page_home.tkraise()

    def _show_dl(self):
        self._current_page = "dl"
        self._page_dl.tkraise()

    def _show_queue(self):
        self._current_page = "queue"
        self._refresh_queue_ui()
        self._page_queue.tkraise()

    # ══════════════════════════════════════════════════════════════════════════
    #  HOME PAGE
    # ══════════════════════════════════════════════════════════════════════════

    def _build_home(self, parent):
        t = self._t
        parent.grid_rowconfigure(0, weight=1)
        parent.grid_columnconfigure(0, weight=1)

        # ── top bar ──────────────────────────────────────────────────────────
        bar = tk.Frame(parent, bg=t["CARD"], pady=10)
        bar.grid(row=0, column=0, sticky="ew")
        bar.grid_columnconfigure(1, weight=1)

        title_lbl = tk.Label(bar, text="🎌 Anime Downloader", bg=t["CARD"],
                             fg=t["ACCENT"], font=F_MD, cursor="hand2")
        title_lbl.grid(row=0, column=0, padx=(20,0))
        title_lbl.bind("<Button-1>", lambda e: self._show_home())

        ctrl = tk.Frame(bar, bg=t["CARD"])
        ctrl.grid(row=0, column=2, padx=(0,16))

        self._h_theme_btn = btn(ctrl, "🌙", self._toggle_theme,
                                bg=t["HDR_BTN"], fg=t["TEXT"], px=10)
        self._h_theme_btn.pack(side="left", padx=(0,6))

        btn(ctrl, "⚙", self._show_settings,
            bg=t["HDR_BTN"], fg=t["TEXT"], px=10).pack(side="left", padx=(0,6))

        self._h_queue_btn = btn(ctrl, "⬇ Queue (0)", self._show_queue,
                                bg=t["HDR_BTN"], fg=t["TEXT"])
        self._h_queue_btn.pack(side="left")

        sep(parent, t).grid(row=1, column=0, sticky="ew")

        # ── centre content ───────────────────────────────────────────────────
        centre = tk.Frame(parent, bg=t["BG"])
        centre.grid(row=2, column=0, sticky="nsew", padx=100, pady=60)
        centre.grid_columnconfigure(0, weight=1)
        parent.grid_rowconfigure(2, weight=1)

        # Title
        tk.Label(centre, text="Anime Downloader", bg=t["BG"],
                 fg=t["TEXT"], font=F_TITLE).grid(row=0, column=0, pady=(0,6))
        tk.Label(centre, text="Search for anime or paste a direct link below.",
                 bg=t["BG"], fg=t["SUBTEXT"], font=F).grid(row=1, column=0,
                                                             pady=(0,32))

        # ── search box ───────────────────────────────────────────────────────
        search_wrap = tk.Frame(centre, bg=t["BG"])
        search_wrap.grid(row=2, column=0)
        search_wrap.grid_columnconfigure(0, weight=1)

        search_box = tk.Frame(search_wrap, bg=t["CARD"],
                              highlightthickness=2,
                              highlightbackground=t["ACCENT"])
        search_box.grid(row=0, column=0, ipadx=4, ipady=4)
        search_box.grid_columnconfigure(0, weight=1)

        self._search_var = tk.StringVar()
        self._search_var.trace_add("write", self._on_search_type)

        self._search_entry = tk.Entry(
            search_box, textvariable=self._search_var,
            bg=t["CARD"], fg=t["TEXT"], insertbackground=t["ACCENT"],
            relief="flat", font=("Segoe UI", 14), width=44,
            bd=0)
        self._search_entry.grid(row=0, column=0, padx=(16,4), pady=10,
                                sticky="ew")
        self._search_entry.insert(0, "Search anime or paste a link…")
        self._search_entry.config(fg=t["SUBTEXT"])
        self._search_entry.bind("<FocusIn>",  self._search_focus_in)
        self._search_entry.bind("<FocusOut>", self._search_focus_out)
        self._search_entry.bind("<Return>",   lambda e: self._do_search())

        self._search_btn = btn(search_box, "Search", self._do_search,
                               bg=t["ACCENT"], font=F_BOLD, px=20, py=10)
        self._search_btn.grid(row=0, column=1, padx=(0,6))

        # ── dropdown suggestions ─────────────────────────────────────────────
        self._suggest_frame = tk.Frame(search_wrap, bg=t["CARD"],
                                       highlightthickness=1,
                                       highlightbackground=t["BORDER"])
        # not gridded until needed

        # ── loading indicator ─────────────────────────────────────────────────
        self._search_loading = tk.Label(centre, text="⏳ Searching...", bg=t["BG"],
                                        fg=t["SUBTEXT"], font=F)
        # not gridded until needed

        # ── search results grid ──────────────────────────────────────────────
        self._results_outer = tk.Frame(centre, bg=t["BG"])
        self._results_outer.grid(row=3, column=0, sticky="nsew", pady=(24,0))
        self._results_outer.grid_columnconfigure(0, weight=1)
        self._results_outer.grid_rowconfigure(0, weight=1)
        centre.grid_rowconfigure(3, weight=1)

        res_canvas = tk.Canvas(self._results_outer, bg=t["BG"],
                               highlightthickness=0)
        res_vsb = ttk.Scrollbar(self._results_outer, orient="vertical",
                                command=res_canvas.yview)
        res_canvas.configure(yscrollcommand=res_vsb.set)
        res_canvas.grid(row=0, column=0, sticky="nsew")
        res_vsb.grid(row=0, column=1, sticky="ns")
        res_canvas.bind("<MouseWheel>", lambda e:
            res_canvas.yview_scroll(int(-e.delta/120), "units"))

        self._results_inner = tk.Frame(res_canvas, bg=t["BG"])
        self._results_win = res_canvas.create_window(
            (0,0), window=self._results_inner, anchor="nw")
        self._results_inner.bind("<Configure>", lambda e:
            res_canvas.configure(scrollregion=res_canvas.bbox("all")))
        res_canvas.bind("<Configure>", lambda e:
            res_canvas.itemconfig(self._results_win, width=e.width))

        self._results_inner.grid_columnconfigure((0,1,2,3), weight=1)

        # status bar
        self._home_status_var = tk.StringVar(value="Ready.")
        tk.Label(parent, textvariable=self._home_status_var,
                 bg=t["CARD"], fg=t["SUBTEXT"], font=F_SM,
                 anchor="w").grid(row=3, column=0, sticky="ew",
                                  padx=20, pady=(0,4))

    # ── search logic ──────────────────────────────────────────────────────────

    def _search_focus_in(self, e):
        if self._search_entry.get() == "Search anime or paste a link…":
            self._search_entry.delete(0, "end")
            self._search_entry.config(fg=self._t["TEXT"])

    def _search_focus_out(self, e):
        if not self._search_entry.get():
            self._search_entry.insert(0, "Search anime or paste a link…")
            self._search_entry.config(fg=self._t["SUBTEXT"])

    def _on_search_type(self, *_):
        q = self._search_var.get().strip()
        # If it looks like a URL → go straight to download page
        if animepahe.is_series_url(q) or animepahe.is_episode_url(q):
            self._hide_suggestions()
            self._home_status_var.set("✓ Link detected — click Search or press Enter")
            return
        self._hide_suggestions()
        if len(q) < 2:
            return
        # Debounce 400 ms
        if self._search_after:
            self.after_cancel(self._search_after)
        self._search_after = self.after(400, lambda: self._suggest(q))

    def _suggest(self, q):
        if self._search_var.get().strip() != q:
            return
        threading.Thread(target=self._suggest_thread, args=(q,),
                         daemon=True).start()

    def _suggest_thread(self, q):
        try:
            results = animepahe.search_anime(q, log=lambda _: None)
            self.after(0, lambda r=results, qq=q: self._show_suggestions(r, qq))
        except Exception:
            pass

    def _show_suggestions(self, results, q):
        if self._search_var.get().strip() != q:
            return
        t = self._t
        sf = self._suggest_frame
        for w in sf.winfo_children():
            w.destroy()

        if not results:
            self._hide_suggestions()
            return

        sf.grid(row=1, column=0, sticky="ew")
        for i, r in enumerate(results[:8]):
            title = r.get("title", "")
            row_bg = t["SEL_BG"] if i % 2 == 0 else t["CARD"]
            row = tk.Frame(sf, bg=row_bg, cursor="hand2")
            row.pack(fill="x")
            tk.Label(row, text=title, bg=row_bg, fg=t["TEXT"],
                     font=F, anchor="w", pady=8, padx=14).pack(
                fill="x")
            row.bind("<Button-1>", lambda e, res=r: self._pick_suggestion(res))
            row.bind("<Enter>",    lambda e, f=row: f.config(bg=t["SEL_BG"]))
            row.bind("<Leave>",    lambda e, f=row, bg=row_bg: f.config(bg=bg))

    def _hide_suggestions(self):
        try:
            if self._suggest_frame.winfo_exists():
                self._suggest_frame.grid_remove()
        except Exception:
            pass

    def _pick_suggestion(self, result):
        title = result.get("title", "")
        sid   = result.get("session", "")
        url   = f"https://animepahe.pw/anime/{sid}"
        self._search_var.set(title)
        self._search_entry.config(fg=self._t["TEXT"])
        self._hide_suggestions()
        self._open_anime(url, result)

    def _do_search(self):
        q = self._search_var.get().strip()
        if q in ("", "Search anime or paste a link…"):
            return
        # Direct URL
        if animepahe.is_series_url(q) or animepahe.is_episode_url(q):
            self._hide_suggestions()
            self._open_anime(q)
            return
        # Full search → show results grid
        self._hide_suggestions()
        self._home_status_var.set(f"Searching for '{q}'…")
        for w in self._results_inner.winfo_children():
            w.destroy()
        self._search_loading.grid(row=3, column=0, pady=(24,0))
        self._results_outer.grid_remove()
        threading.Thread(target=self._search_thread, args=(q,),
                         daemon=True).start()

    def _search_thread(self, q):
        try:
            results = animepahe.search_anime(q, log=lambda _: None)
            self.after(0, lambda r=results: self._show_results(r, q))
        except Exception as exc:
            msg = str(exc)
            self.after(0, lambda m=msg: self._search_failed(m))

    def _search_failed(self, msg):
        self._search_loading.grid_remove()
        self._results_outer.grid()
        self._home_status_var.set(f"Search failed: {msg}")

    def _show_results(self, results, q):
        t = self._t
        self._search_loading.grid_remove()
        self._results_outer.grid()
        for w in self._results_inner.winfo_children():
            w.destroy()
        if not results:
            tk.Label(self._results_inner, text="No results found.",
                     bg=t["BG"], fg=t["SUBTEXT"], font=F).grid(
                row=0, column=0, pady=20)
            self._home_status_var.set(f"No results for '{q}'")
            return

        self._home_status_var.set(f"{len(results)} results for '{q}'")
        cols = 4
        for i, r in enumerate(results):
            row_i, col_i = divmod(i, cols)
            self._make_result_card(self._results_inner, r, row_i, col_i)

    def _make_result_card(self, parent, result, row, col):
        t    = self._t
        sid  = result.get("session", "")
        url  = f"https://animepahe.pw/anime/{sid}"
        title = result.get("title", "Unknown")
        ep   = result.get("episodes", "?")
        typ  = result.get("type", "")

        c = tk.Frame(parent, bg=t["CARD"],
                     highlightthickness=1,
                     highlightbackground=t["BORDER"],
                     cursor="hand2")
        c.grid(row=row, column=col, padx=8, pady=8, sticky="nsew")

        # Poster placeholder
        poster_lbl = tk.Label(c, text="🎌", bg=t["CARD"],
                              fg=t["MUTED"], font=("Segoe UI", 24),
                              width=14, height=6)
        poster_lbl.pack(pady=(10,4))

        tk.Label(c, text=title, bg=t["CARD"], fg=t["TEXT"],
                 font=F_BOLD, wraplength=160, justify="center").pack(
            padx=10, pady=(0,2))
        tk.Label(c, text=f"{typ}  •  {ep} eps", bg=t["CARD"],
                 fg=t["SUBTEXT"], font=F_SM).pack(pady=(0,8))

        btn(c, "Download", lambda u=url, r=result: self._open_anime(u, r),
            bg=t["ACCENT"], font=F_SM, py=5).pack(pady=(0,10))

        # hover
        for w in (c, poster_lbl):
            w.bind("<Enter>", lambda e, f=c: f.config(
                highlightbackground=t["ACCENT"]))
            w.bind("<Leave>", lambda e, f=c: f.config(
                highlightbackground=t["BORDER"]))
            w.bind("<Button-1>", lambda e, u=url, r=result:
                   self._open_anime(u, r))

        # load poster async
        poster_url = result.get("poster","") or result.get("image","")
        if poster_url:
            threading.Thread(target=self._load_card_poster,
                             args=(poster_url, poster_lbl),
                             daemon=True).start()

    def _load_card_poster(self, url, lbl):
        try:
            from PIL import Image, ImageTk
            import io
            resp = _sess.request("GET", url,
                                 headers={"Referer":"https://animepahe.pw"})
            data = resp.content
            if not data: return
            img  = Image.open(io.BytesIO(data)).resize((140,196), Image.LANCZOS)
            ph   = ImageTk.PhotoImage(img)
            self.after(0, lambda: (lbl.config(image=ph, text="",
                                              width=140, height=196),
                                   setattr(lbl, "image", ph)))
        except Exception:
            pass

    def _open_anime(self, url, meta=None):
        self._show_dl()
        self._ep_vars.clear()
        self._ep_data.clear()
        self._total_eps  = 0
        self._fetched_to = 0
        for w in self._ep_inner.winfo_children():
            w.destroy()
        # Reset info card
        self._dl_title_lbl.config(text="⏳ Loading...")
        self._dl_meta_lbl.config(text="")
        self._dl_poster_lbl.config(image="", text="🎌",
                                    width=11, height=7)
        if hasattr(self, "_dl_poster_img"):
            del self._dl_poster_img

        self._stop_fetch.clear()
        threading.Thread(target=self._fetch_thread,
                         args=(url, 1, False, meta),
                         daemon=True).start()

    # ══════════════════════════════════════════════════════════════════════════
    #  DOWNLOAD PAGE
    # ══════════════════════════════════════════════════════════════════════════

    def _build_dl(self, parent):
        t = self._t
        parent.grid_rowconfigure(2, weight=1)
        parent.grid_columnconfigure(0, weight=1)

        # ── top bar ──────────────────────────────────────────────────────────
        bar = tk.Frame(parent, bg=t["CARD"], pady=10)
        bar.grid(row=0, column=0, sticky="ew")
        bar.grid_columnconfigure(1, weight=1)

        btn(bar, "← Back", self._show_home,
            bg=t["HDR_BTN"], fg=t["TEXT"]).grid(
            row=0, column=0, padx=(16,0))

        title_lbl = tk.Label(bar, text="🎌 Anime Downloader",
                             bg=t["CARD"], fg=t["ACCENT"],
                             font=F_MD, cursor="hand2")
        title_lbl.grid(row=0, column=1, sticky="w", padx=16)
        title_lbl.bind("<Button-1>", lambda e: self._show_home())

        ctrl = tk.Frame(bar, bg=t["CARD"])
        ctrl.grid(row=0, column=2, padx=(0,16))

        self._dl_theme_btn = btn(ctrl, "🌙", self._toggle_theme,
                                 bg=t["HDR_BTN"], fg=t["TEXT"], px=10)
        self._dl_theme_btn.pack(side="left", padx=(0,6))
        btn(ctrl, "⚙", self._show_settings,
            bg=t["HDR_BTN"], fg=t["TEXT"], px=10).pack(side="left", padx=(0,6))

        self._dl_queue_btn = btn(ctrl, "⬇ Queue (0)", self._show_queue,
                                 bg=t["HDR_BTN"], fg=t["TEXT"])
        self._dl_queue_btn.pack(side="left", padx=(0,8))

        self._cf_lbl = tk.Label(ctrl, text="🛡 CF Ready",
                                fg=t["SUCCESS"], bg=t["CARD"], font=F_SM)
        self._cf_lbl.pack(side="left")

        sep(parent, t).grid(row=1, column=0, sticky="ew")

        # ── scrollable body ───────────────────────────────────────────────────
        host = tk.Frame(parent, bg=t["BG"])
        host.grid(row=2, column=0, sticky="nsew")
        host.grid_rowconfigure(0, weight=1)
        host.grid_columnconfigure(0, weight=1)

        cv  = tk.Canvas(host, bg=t["BG"], highlightthickness=0)
        vsb = ttk.Scrollbar(host, orient="vertical", command=cv.yview)
        cv.configure(yscrollcommand=vsb.set)
        cv.grid(row=0, column=0, sticky="nsew")
        vsb.grid(row=0, column=1, sticky="ns")
        cv.bind("<MouseWheel>", lambda e:
            cv.yview_scroll(int(-e.delta/120), "units"))

        body = tk.Frame(cv, bg=t["BG"])
        bwin = cv.create_window((0,0), window=body, anchor="nw")
        body.bind("<Configure>", lambda e:
            cv.configure(scrollregion=cv.bbox("all")))
        cv.bind("<Configure>", lambda e:
            cv.itemconfig(bwin, width=e.width))
        body.grid_columnconfigure(0, weight=1)
        self._dl_body = body

        self._build_dl_info(body)      # row 0
        self._build_dl_filters(body)   # row 1
        self._build_dl_eplist(body)    # row 2
        self._build_dl_actions(body)   # row 3
        self._build_dl_progress(body)  # row 4
        self._build_dl_log(body)       # row 5

    # ── info card ─────────────────────────────────────────────────────────────

    def _build_dl_info(self, parent):
        t = self._t
        c = card(parent, t)
        c.grid(row=0, column=0, sticky="ew", padx=20, pady=(16,6))
        c.grid_columnconfigure(1, weight=1)

        self._dl_poster_lbl = tk.Label(c, text="🎌", bg=t["CARD"],
                                       fg=t["MUTED"], font=("Segoe UI",24),
                                       width=11, height=7,
                                       highlightthickness=1,
                                       highlightbackground=t["BORDER"])
        self._dl_poster_lbl.grid(row=0, column=0, rowspan=3,
                                 padx=(16,14), pady=14, sticky="nw")

        self._dl_title_lbl = tk.Label(c, text="⏳ Loading...",
                                      bg=t["CARD"], fg=t["TEXT"],
                                      font=F_LG, anchor="w")
        self._dl_title_lbl.grid(row=0, column=1, sticky="w", pady=(14,2))

        self._dl_meta_lbl = tk.Label(c, text="", bg=t["CARD"],
                                     fg=t["SUBTEXT"], font=F_SM, anchor="w")
        self._dl_meta_lbl.grid(row=1, column=1, sticky="w")

        self._dl_desc_lbl = tk.Label(c, text="", bg=t["CARD"],
                                     fg=t["SUBTEXT"], font=F_SM, anchor="w",
                                     wraplength=700, justify="left")
        self._dl_desc_lbl.grid(row=2, column=1, sticky="w", pady=(4,14))

    def _set_dl_info(self, title, meta_line, poster_url):
        self._dl_title_lbl.config(text=title)
        self._dl_meta_lbl.config(text=meta_line)
        if poster_url:
            threading.Thread(target=self._load_dl_poster,
                             args=(poster_url,), daemon=True).start()

    def _load_dl_poster(self, url):
        try:
            from PIL import Image, ImageTk
            import io
            resp = _sess.request("GET", url,
                                 headers={"Referer":"https://animepahe.pw"})
            data = resp.content
            if not data: return
            img = Image.open(io.BytesIO(data)).resize((90,126), Image.LANCZOS)
            ph  = ImageTk.PhotoImage(img)
            self._dl_poster_img = ph
            self.after(0, lambda: self._dl_poster_lbl.config(
                image=ph, text="", width=90, height=126,
                highlightthickness=0))
        except Exception:
            pass

    # ── filter / quality bar ──────────────────────────────────────────────────

    def _build_dl_filters(self, parent):
        t = self._t
        c = card(parent, t, padx=18, pady=10)
        c.grid(row=1, column=0, sticky="ew", padx=20, pady=6)
        c.grid_columnconfigure(4, weight=1)

        tk.Label(c, text="Filters", bg=t["CARD"], fg=t["SUBTEXT"],
                 font=F_BOLD).grid(row=0, column=0, padx=(0,16))

        self._last5 = tk.BooleanVar()
        tk.Checkbutton(c, text="Last 5", variable=self._last5,
                       bg=t["CARD"], fg=t["TEXT"], selectcolor=t["CHK_BG"],
                       activebackground=t["CARD"], font=F, cursor="hand2",
                       command=self._filter_eps).grid(row=0, column=1, padx=(0,12))

        self._ep_filter = tk.StringVar()
        self._ep_filter.trace_add("write", lambda *_: self._filter_eps())
        fe = entry(c, self._ep_filter, t, width=20)
        fe.insert(0, "Filter episodes…")
        fe.config(fg=t["SUBTEXT"])
        fe.bind("<FocusIn>",  lambda e: self._ph(fe, True,  "Filter episodes…"))
        fe.bind("<FocusOut>", lambda e: self._ph(fe, False, "Filter episodes…"))
        fe.grid(row=0, column=4, sticky="ew", padx=(0,16))

        tk.Label(c, text="Quality", bg=t["CARD"], fg=t["SUBTEXT"],
                 font=F_SM).grid(row=0, column=5, padx=(0,4))
        self._quality = tk.StringVar(value="Max")
        ttk.Combobox(c, textvariable=self._quality, width=7,
                     values=["Max","Min","1080","720","480","360"],
                     state="readonly", font=F).grid(row=0, column=6, padx=(0,12))

        tk.Label(c, text="Audio", bg=t["CARD"], fg=t["SUBTEXT"],
                 font=F_SM).grid(row=0, column=7, padx=(0,4))
        self._audio = tk.StringVar(value="jp")
        ttk.Combobox(c, textvariable=self._audio, width=10,
                     values=["jp (Japanese)","en (English)","zh (Chinese)"],
                     state="readonly", font=F).grid(row=0, column=8)

    def _ph(self, e, focus_in, ph):
        t = self._t
        if focus_in and e.get() == ph:
            e.delete(0,"end"); e.config(fg=t["TEXT"])
        elif not focus_in and not e.get():
            e.insert(0, ph); e.config(fg=t["SUBTEXT"])

    # ── episode list ──────────────────────────────────────────────────────────

    def _build_dl_eplist(self, parent):
        t = self._t
        outer = tk.Frame(parent, bg=t["BORDER"], padx=1, pady=1)
        outer.grid(row=2, column=0, sticky="nsew", padx=20, pady=6)
        outer.grid_rowconfigure(0, weight=1)
        outer.grid_columnconfigure(0, weight=1)

        inner = tk.Frame(outer, bg=t["PANEL"])
        inner.grid(sticky="nsew")
        inner.grid_rowconfigure(1, weight=1)
        inner.grid_columnconfigure(0, weight=1)

        # column headers
        hdr = tk.Frame(inner, bg=t["BORDER"])
        hdr.grid(row=0, column=0, sticky="ew")
        hdr.grid_columnconfigure(3, weight=1)
        for col, (lbl, w) in enumerate([
            ("✓",2),("#",3),("Thumbnail",12),("Episode",0),("Audio",7),("Status",7)
        ]):
            tk.Label(hdr, text=lbl, bg=t["BORDER"], fg=t["SUBTEXT"],
                     font=F_SM, width=w or None,
                     anchor="w" if col==3 else "center").grid(
                row=0, column=col,
                sticky="ew" if col==3 else "",
                padx=(10,0) if col==0 else 4, pady=5)

        # canvas
        ep_host = tk.Frame(inner, bg=t["PANEL"])
        ep_host.grid(row=1, column=0, sticky="nsew")
        ep_host.grid_rowconfigure(0, weight=1)
        ep_host.grid_columnconfigure(0, weight=1)

        self._ep_canvas = tk.Canvas(ep_host, bg=t["PANEL"],
                                    highlightthickness=0, height=280)
        ep_vsb = ttk.Scrollbar(ep_host, orient="vertical",
                               command=self._ep_canvas.yview)
        self._ep_canvas.configure(yscrollcommand=ep_vsb.set)
        self._ep_inner = tk.Frame(self._ep_canvas, bg=t["PANEL"])
        self._ep_win   = self._ep_canvas.create_window(
            (0,0), window=self._ep_inner, anchor="nw")
        self._ep_inner.bind("<Configure>", lambda e:
            self._ep_canvas.configure(
                scrollregion=self._ep_canvas.bbox("all")))
        self._ep_canvas.bind("<Configure>", lambda e:
            self._ep_canvas.itemconfig(self._ep_win, width=e.width))
        self._ep_canvas.bind("<MouseWheel>", lambda e:
            self._ep_canvas.yview_scroll(int(-e.delta/120),"units"))
        self._ep_canvas.grid(row=0, column=0, sticky="nsew")
        ep_vsb.grid(row=0, column=1, sticky="ns")
        self._ep_inner.grid_columnconfigure(3, weight=1)

        # placeholder
        self._ep_placeholder = tk.Label(
            self._ep_inner,
            text="Loading episodes…",
            fg=t["SUBTEXT"], bg=t["PANEL"], font=F_SM)
        self._ep_placeholder.grid(row=0, column=0,
                                   columnspan=6, padx=20, pady=24)

        # bottom bar
        bot = tk.Frame(inner, bg=t["CARD"], pady=5)
        bot.grid(row=2, column=0, sticky="ew")
        btn(bot, "✓ All",  self._sel_all,
            bg=t["HDR_BTN"], fg=t["TEXT"], py=4).pack(side="left", padx=(10,4))
        btn(bot, "✗ None", self._sel_none,
            bg=t["HDR_BTN"], fg=t["TEXT"], py=4).pack(side="left", padx=(0,12))
        self._load_more_btn = btn(bot, "⬇ Load Next 50",
                                  self._load_next,
                                  bg=t["ACCENT"], py=4, state="disabled")
        self._load_more_btn.pack(side="left")
        self._batch_lbl = tk.Label(bot, text="", bg=t["CARD"],
                                    fg=t["SUBTEXT"], font=F_SM)
        self._batch_lbl.pack(side="left", padx=(10,0))

    # ── actions card ──────────────────────────────────────────────────────────

    def _build_dl_actions(self, parent):
        t = self._t
        c = card(parent, t, padx=18, pady=14)
        c.grid(row=3, column=0, sticky="ew", padx=20, pady=6)
        c.grid_columnconfigure(1, weight=1)

        tk.Label(c, text="Save to", bg=t["CARD"], fg=t["SUBTEXT"],
                 font=F_BOLD).grid(row=0, column=0, padx=(0,12))

        self._dir_entry = entry(c, self._dir, t)
        self._dir_entry.grid(row=0, column=1, sticky="ew", padx=(0,8))
        self._dir_entry.bind("<KeyRelease>", lambda e: self._upd_disk())

        btn(c, "Browse", self._browse,
            bg=t["HDR_BTN"], fg=t["TEXT"], py=8).grid(
            row=0, column=2, padx=(0,16))

        self._solve_btn = btn(c, "🛡 Solve CF", self._solve_cf,
                              bg="#7c3aed", py=8)
        self._solve_btn.grid(row=0, column=3, padx=(0,8))

        btn(c, "+ Queue", self._add_to_queue,
            bg=t["SUCCESS"], py=8).grid(row=0, column=4, padx=(0,8))

        self.start_btn = btn(c, "⬇  Start Download", self._start,
                             bg=t["ACCENT"], font=F_BOLD, px=20, py=10)
        self.start_btn.grid(row=0, column=5, padx=(0,8))

        self.stop_btn = btn(c, "⏹ Stop", self._stop_dl,
                            bg=t["DANGER"], py=10, state="disabled")
        self.stop_btn.grid(row=0, column=6)

        self._disk_var = tk.StringVar(value=self._get_disk())
        tk.Label(c, textvariable=self._disk_var, bg=t["CARD"],
                 fg=t["SUBTEXT"], font=F_SM).grid(
            row=1, column=1, columnspan=4, sticky="w", pady=(5,0))

    # ── progress card ─────────────────────────────────────────────────────────

    def _build_dl_progress(self, parent):
        t = self._t
        c = card(parent, t, padx=18, pady=12)
        c.grid(row=4, column=0, sticky="ew", padx=20, pady=6)
        c.grid_columnconfigure(1, weight=1)
        for row, (lbl, style, vname, iname) in enumerate([
            ("Overall", "A.Horizontal.TProgressbar", "overall_var", "_ov_info"),
            ("File",    "S.Horizontal.TProgressbar", "file_var",    "_fi_info"),
        ]):
            tk.Label(c, text=lbl, bg=t["CARD"], fg=t["SUBTEXT"],
                     font=F_SM, width=7, anchor="w").grid(
                row=row, column=0, sticky="w",
                pady=(0 if row==0 else 6, 0))
            dv = tk.DoubleVar()
            setattr(self, vname, dv)
            ttk.Progressbar(c, variable=dv, maximum=100,
                            style=style).grid(
                row=row, column=1, sticky="ew", padx=(0,10),
                pady=(0 if row==0 else 6, 0))
            iv = tk.StringVar()
            setattr(self, iname, iv)
            tk.Label(c, textvariable=iv,
                     fg=t["ACCENT"] if row==0 else t["SUCCESS"],
                     bg=t["CARD"], font=F_SM, anchor="e", width=26).grid(
                row=row, column=2, sticky="e",
                pady=(0 if row==0 else 6, 0))

    # ── log card ──────────────────────────────────────────────────────────────

    def _build_dl_log(self, parent):
        t = self._t
        border = tk.Frame(parent, bg=t["BORDER"], padx=1, pady=1)
        border.grid(row=5, column=0, sticky="ew",
                    padx=20, pady=(6,20))
        border.grid_columnconfigure(0, weight=1)
        self._log_border = border

        self.log_box = tk.Text(
            border, bg=t["TERM_BG"], fg=t["TERM_FG"],
            insertbackground=t["ACCENT"], font=F_MONO,
            relief="flat", state="disabled", wrap="word",
            padx=12, pady=10, height=8)
        self.log_box.tag_config("err",  foreground=t["DANGER"])
        self.log_box.tag_config("ok",   foreground=t["SUCCESS"])
        self.log_box.tag_config("info", foreground=t["SUBTEXT"])
        scroll = ttk.Scrollbar(border, orient="vertical",
                               command=self.log_box.yview)
        self.log_box.configure(yscrollcommand=scroll.set)
        self.log_box.grid(row=0, column=0, sticky="nsew")
        scroll.grid(row=0, column=1, sticky="ns")

    # ── episode list population ───────────────────────────────────────────────

    def _populate_eps(self, raw, title, sid, append=False):
        t = self._t
        self._series_title = title
        self._series_id    = sid

        if not append:
            self._ep_data  = list(raw)
            self._thumbs   = {}
            for w in self._ep_inner.winfo_children():
                w.destroy()
            self._ep_vars.clear()
        else:
            self._ep_data.extend(raw)

        has_more = self._fetched_to < self._total_eps
        self._load_more_btn.config(
            state="normal" if has_more else "disabled",
            text="⬇ Load Next 50" if has_more else "All Loaded")
        self._batch_lbl.config(
            text=f"Showing {self._fetched_to} of {self._total_eps}")

        if not raw and not append:
            tk.Label(self._ep_inner, text="No episodes found.",
                     fg=t["DANGER"], bg=t["PANEL"],
                     font=F_SM).grid(row=0, column=0, pady=16)
            return

        offset = len(self._ep_vars) if append else 0

        for i, ep in enumerate(raw):
            ep_num  = ep.get("episode", i+1)
            ep_ttl  = ep.get("title") or f"Episode {ep_num}"
            session = ep.get("session","")
            snap    = ep.get("snapshot","")
            audio   = ep.get("audio","jpn")
            filler  = ep.get("filler",0)
            purl    = f"https://animepahe.pw/play/{sid}/{session}"
            lbl     = f"Ep {ep_num} — {ep_ttl}"

            var = tk.BooleanVar(value=True)
            self._ep_vars.append((var, lbl, purl, ep_num))

            ri     = offset + i
            row_bg = t["PANEL"] if ri%2==0 else t["ROW_ALT"]

            rf = tk.Frame(self._ep_inner, bg=row_bg,
                          highlightthickness=1,
                          highlightbackground=row_bg)
            rf.grid(row=ri, column=0, sticky="ew", padx=2, pady=1)
            rf.grid_columnconfigure(3, weight=1)
            rf.bind("<Enter>", lambda e, f=rf:
                f.config(highlightbackground=t["ACCENT"]))
            rf.bind("<Leave>", lambda e, f=rf, bg=row_bg:
                f.config(highlightbackground=bg))

            tk.Checkbutton(rf, variable=var, bg=row_bg,
                           activebackground=row_bg,
                           selectcolor=t["CHK_BG"],
                           cursor="hand2", relief="flat").grid(
                row=0, column=0, padx=(10,4), pady=8)

            tk.Label(rf, text=str(int(ep_num)), fg=t["SUBTEXT"],
                     bg=row_bg, font=F_SM, width=4,
                     anchor="center").grid(row=0, column=1, padx=(0,6))

            thumb = tk.Label(rf, text="🖼", bg=row_bg,
                             fg=t["MUTED"], width=12, height=4, font=F_SM)
            thumb.grid(row=0, column=2, padx=(0,10), pady=6)

            info = tk.Frame(rf, bg=row_bg)
            info.grid(row=0, column=3, sticky="ew", pady=6)
            tk.Label(info, text=f"Episode {int(ep_num)}",
                     fg=t["TEXT"], bg=row_bg, font=F_BOLD,
                     anchor="w").pack(anchor="w")
            tk.Label(info, text=ep_ttl, fg=t["SUBTEXT"],
                     bg=row_bg, font=F_SM, anchor="w").pack(anchor="w")

            is_jp    = "jpn" in audio.lower() or audio.lower()=="jp"
            aud_bg   = t["ACCENT"] if is_jp else t["SUCCESS"]
            aud_txt  = "JPN" if is_jp else audio.upper()[:3]
            tk.Label(rf, text=aud_txt, fg="white", bg=aud_bg,
                     font=F_SM, padx=8, pady=3).grid(
                row=0, column=4, padx=(0,8))

            stxt = "Filler" if filler else "Ready"
            sbg  = t["WARNING"] if filler else t["BORDER"]
            tk.Label(rf, text=stxt, fg="white", bg=sbg,
                     font=F_SM, padx=8, pady=3, width=6).grid(
                row=0, column=5, padx=(0,10))

            if snap:
                threading.Thread(target=self._load_thumb,
                                 args=(snap, thumb, ri),
                                 daemon=True).start()

        self._filter_eps()
        self._log_ok(f"Loaded {len(raw)} episodes for: {title}")

    def _load_thumb(self, url, lbl, idx):
        try:
            from PIL import Image, ImageTk
            import io
            resp = _sess.request("GET", url,
                                 headers={"Referer":"https://animepahe.pw"})
            data = resp.content
            if not data: return
            img = Image.open(io.BytesIO(data)).resize((112,63), Image.LANCZOS)
            ph  = ImageTk.PhotoImage(img)
            self._thumbs[idx] = ph
            self.after(0, lambda l=lbl, p=ph: (
                l.config(image=p, text="", width=112, height=63),
                setattr(l,"image",p)))
        except Exception:
            pass

    def _sel_all(self):
        for v,*_ in self._ep_vars: v.set(True)

    def _sel_none(self):
        for v,*_ in self._ep_vars: v.set(False)

    def _filter_eps(self):
        t       = self._t
        flt     = self._ep_filter.get().strip().lower()
        last5   = self._last5.get()
        total   = len(self._ep_vars)
        for i, (var, lbl, url, _) in enumerate(self._ep_vars):
            rows = self._ep_inner.grid_slaves(row=i)
            if not rows: continue
            show = True
            if flt and flt != "filter episodes…" and flt not in lbl.lower():
                show = False
            if last5 and i < total-5:
                show = False
            rows[0].grid() if show else rows[0].grid_remove()

    # ── fetch thread ──────────────────────────────────────────────────────────

    def _fetch_thread(self, url, start_ep=1, append=False, meta=None):
        cf   = self._cf_kw()
        is_s = animepahe.is_series_url(url)

        def stopped(): return self._stop_fetch.is_set()
        cf["stop_flag"] = stopped

        try:
            if meta is None:
                meta = animepahe.fetch_metadata(url, is_s,
                                                log=self._log_dim, **cf)
            title  = meta.get("title","Unknown")
            poster = meta.get("poster","")
            sid    = meta.get("id") or (
                animepahe.get_series_id(url) if is_s else None)
            ep_cnt = meta.get("episode_count","")
            atype  = meta.get("type","")
            mline  = "  •  ".join(filter(None,[
                atype, f"{ep_cnt} Episodes" if ep_cnt else ""]))

            if not append:
                self.after(0, lambda: self._set_dl_info(title, mline, poster))
            self._log_ok(f"Title: {title}")

            if is_s:
                try:    total = int(str(meta.get("episode_count") or "0"))
                except: total = 0
                if total == 0:
                    try:    total = animepahe.get_episode_count(sid, url, **cf)
                    except: total = 1000
                self._total_eps = total
                end_ep  = min(start_ep + BATCH - 1, total)
                pages   = max(1,(total+29)//30)
                sp = max(1, min((start_ep-1)//30+1, pages))
                ep = max(1, min((end_ep-1)//30+1,   pages))

                raw = []
                for pg in range(sp, ep+1):
                    if stopped(): return
                    r = _sess.request(
                        "GET",
                        f"{animepahe.API_BASE}/api?m=release&id={sid}"
                        f"&sort=episode_asc&page={pg}",
                        headers={"Referer":"https://animepahe.pw/"}, **cf)
                    r.raise_for_status()
                    for ep_d in r.json().get("data",[]):
                        n = ep_d.get("episode",0)
                        if start_ep <= n <= end_ep:
                            raw.append(ep_d)
                self._fetched_to = end_ep
            else:
                sid2, session = _get_play_ids(url)
                raw = [{"episode":1,"title":"Episode","snapshot":"",
                        "session":session,"filler":0,"audio":"jpn"}]
                sid = sid2
                self._total_eps  = 1
                self._fetched_to = 1

            if stopped(): return
            self.after(0, lambda r=raw, t=title, s=sid, a=append:
                       self._populate_eps(r, t, s, append=a))

        except Exception as e:
            self._log_err(f"Fetch failed: {e}")

    def _load_next(self):
        url = ""
        # get url from entry isn't stored — store it
        if not hasattr(self,"_current_url"): return
        next_s = self._fetched_to + 1
        if next_s > self._total_eps: return
        self._stop_fetch.clear()
        threading.Thread(target=self._fetch_thread,
                         args=(self._current_url, next_s, True),
                         daemon=True).start()

    # ── actions ───────────────────────────────────────────────────────────────

    def _cf_kw(self):
        return dict(
            use_cloudscraper=False, use_browser=False,
            use_flaresolverr=True,
            browser_type="chrome", browser_headless=True,
            browser_incognito=False)

    def _browse(self):
        d = filedialog.askdirectory()
        if d:
            self._dir.set(d)
            self._upd_disk()

    def _upd_disk(self):
        self._disk_var.set(self._get_disk())

    def _get_disk(self):
        try:
            import shutil
            p = self._dir.get() if hasattr(self,"_dir") \
                else os.path.expanduser("~/Downloads")
            if not os.path.exists(p):
                p = os.path.expanduser("~/Downloads")
            u = shutil.disk_usage(p)
            return f"Available {_fmt_size(u.free)} of {_fmt_size(u.total)}"
        except: return "N/A"

    def _solve_cf(self):
        self._solve_btn.config(state="disabled", text="⏳ Solving…")
        threading.Thread(target=self._solve_cf_t, daemon=True).start()

    def _solve_cf_t(self):
        try:
            _flaresolverr.ensure_running()
            ok = _sess.solve_cf_once(url="https://animepahe.pw",
                                     force=True, log_fn=self._log_dim)
        except Exception as e:
            ok = False
            self._log_err(str(e))
        def done():
            self._solve_btn.config(state="normal", text="🛡 Solve CF")
            if ok:
                self._log_ok("CF solved!")
                self._cf_lbl.config(text="🛡 CF ✓", fg=self._t["SUCCESS"])
            else:
                self._log_err("CF solve failed.")
        self.after(0, done)

    def _start(self):
        if not self._ep_vars:
            messagebox.showwarning("No Episodes", "Fetch episodes first.")
            return
        self._stop.clear()
        self._set_btns(True)
        self.overall_var.set(0); self._ov_info.set("")
        self.file_var.set(0);    self._fi_info.set("")
        self.log_box.config(state="normal")
        self.log_box.delete("1.0","end")
        self.log_box.config(state="disabled")
        threading.Thread(target=self._run, daemon=True).start()

    def _stop_dl(self):
        self._stop.set()
        self._log_dim("Stop requested…")

    def _set_btns(self, running):
        t = self._t
        def _do():
            self.start_btn.config(
                state="disabled" if running else "normal",
                bg=t["BORDER"] if running else t["ACCENT"])
            self.stop_btn.config(state="normal" if running else "disabled")
        self.after(0, _do)

    # ── download runner ───────────────────────────────────────────────────────

    def _run(self):
        qual     = self._quality.get()
        audio    = self._audio.get().split()[0]
        save_dir = self._dir.get().strip()
        cf       = self._cf_kw()

        tres = 0
        if qual == "Min":             tres = -1
        elif qual not in ("Max",""): tres = int(qual)

        play_links  = [(u, n) for v, _, u, n in self._ep_vars if v.get()]
        title       = self._series_title or "anime"
        total_count = len(play_links)

        if not play_links:
            self._log_err("No episodes selected.")
            self._set_btns(False)
            return

        dest_dir = os.path.join(save_dir, "Anime", _sanitize(title))
        os.makedirs(dest_dir, exist_ok=True)
        self._log_dim(f"Saving {total_count} ep(s) → {dest_dir}")
        self.overall_var.set(0)
        self._ov_info.set(f"0 / {total_count} episodes")

        import queue
        q = queue.Queue()
        for idx, (purl, epn) in enumerate(play_links):
            q.put((idx, purl, epn))

        lock      = threading.Lock()
        active    = {}
        completed = set()

        def worker():
            while not q.empty() and not self._stop.is_set():
                try: idx, play_url, ep_num = q.get_nowait()
                except queue.Empty: break

                ep_i = idx + 1

                # skip if valid file exists
                existing = _find_existing_ep(dest_dir, ep_num)
                if existing and _is_valid_video(existing):
                    self._log_dim(f"EP{ep_num:g} ✓ exists, skipping.")
                    with lock:
                        completed.add(play_url)
                        self._set_overall(
                            len(completed)/total_count*100,
                            f"{len(completed)} / {total_count} episodes")
                    q.task_done(); continue

                self._log_dim(f"[{ep_i}/{total_count}] Extracting…")
                try:
                    pahe   = animepahe.fetch_pahe_win_links(
                        play_url, tres, audio, **cf)
                    dl_map = kwik.extract_kwik_link(pahe["dPaheLink"])
                except Exception as e:
                    self._log_err(f"EP{ep_num:g} link error: {e}")
                    with lock:
                        completed.add(play_url)
                        self._set_overall(
                            len(completed)/total_count*100,
                            f"{len(completed)} / {total_count} episodes")
                    q.task_done(); continue

                direct  = dl_map["directLink"]
                referer = dl_map["referer"]
                res_lbl = f"{pahe['epRes']}p" if pahe.get("epRes") else "?"
                self._log_dim(f"↓ EP{ep_num:g} [{res_lbl}]")

                def on_prog(done, total, speed, eta, _u=play_url):
                    with lock:
                        active[_u] = (done, total, speed, eta)
                        td=ts=tspd=0; etas=[]
                        for d,t2,s,e in active.values():
                            td+=d; ts+=t2; tspd+=s
                            if e>0: etas.append(e)
                        pct = (td/ts*100) if ts else 0
                        ea  = max(etas) if etas else 0
                        cc  = len(completed)
                        opct= ((cc + pct/100)/total_count)*100
                        sz  = f"{_fmt_size(td)}/{_fmt_size(ts)}" if ts else _fmt_size(td)
                        spd = f"{_fmt_size(tspd)}/s" if tspd else "…"
                        eta_s = f"ETA {_fmt_time(ea)}" if ea else ""
                        self._set_file(pct, f"{sz}  {spd}  {eta_s}")
                        self._set_overall(opct, f"{cc}/{total_count} episodes")

                try:
                    path = downloader.download(
                        url=direct, referer=referer,
                        dest_dir=dest_dir,
                        on_progress=on_prog,
                        stop_flag=self._stop.is_set)
                    self._log_ok(f"EP{ep_num:g} → {os.path.basename(path)}")
                    self.after(0, lambda u=play_url: self._uncheck(u))
                except InterruptedError:
                    self._log_dim(f"EP{ep_num:g} stopped.")
                except Exception as e:
                    self._log_err(f"EP{ep_num:g} error: {e}")
                finally:
                    with lock:
                        completed.add(play_url)
                        active.pop(play_url, None)
                        self._set_overall(
                            len(completed)/total_count*100,
                            f"{len(completed)} / {total_count} episodes")
                    q.task_done()

        wcount = min(self._max_dl, total_count)
        self._log_dim(f"Starting {wcount} workers…")
        threads = [threading.Thread(target=worker, daemon=True)
                   for _ in range(wcount)]
        for tw in threads: tw.start()
        for tw in threads: tw.join()

        if self._stop.is_set():
            self._log_dim("Stopped.")
        else:
            self._log_ok("All done! 🎉")
            self._set_overall(100, f"{total_count} / {total_count} episodes")
        self._set_btns(False)

    def _uncheck(self, url):
        for v, _, u, _ in self._ep_vars:
            if u == url: v.set(False); break

    def _set_file(self, p, lbl=""):
        self.after(0, lambda: (self.file_var.set(p),
                               self._fi_info.set(lbl)))

    def _set_overall(self, p, lbl=""):
        self.after(0, lambda: (self.overall_var.set(p),
                               self._ov_info.set(lbl)))

    # ── logging ───────────────────────────────────────────────────────────────

    def _log(self, msg, tag=""):
        def _do():
            self.log_box.config(state="normal")
            self.log_box.insert("end", msg+"\n", tag or ())
            self.log_box.see("end")
            self.log_box.config(state="disabled")
        self.after(0, _do)

    def _log_ok(self,  m): self._log(f"[OK]   {m}", "ok")
    def _log_err(self, m): self._log(f"[ERR]  {m}", "err")
    def _log_dim(self, m): self._log(f"[INFO] {m}", "info")

    # ── theme toggle ──────────────────────────────────────────────────────────

    def _toggle_theme(self):
        prev_page = self._current_page
        self._t = DARK if self._t is LIGHT else LIGHT
        icon = "☀" if self._t is DARK else "🌙"
        self._apply_style()
        for w in self.winfo_children():
            w.destroy()
        self._ep_filter = tk.StringVar()
        self._ep_vars   = []
        self._thumbs    = {}
        self._build()
        self.configure(bg=self._t["BG"])
        self._h_theme_btn.config(text=icon)
        self._dl_theme_btn.config(text=icon)
        if hasattr(self, '_q_theme_btn'):
            self._q_theme_btn.config(text=icon)
        # Restore the page the user was on
        if prev_page == "dl":
            self._show_dl()
        elif prev_page == "queue":
            self._show_queue()
        else:
            self._show_home()

    # ── queue page ─────────────────────────────────────────────────────────────

    def _build_queue(self, parent):
        t = self._t
        parent.grid_rowconfigure(2, weight=1)
        parent.grid_columnconfigure(0, weight=1)

        bar = tk.Frame(parent, bg=t["CARD"], pady=10)
        bar.grid(row=0, column=0, sticky="ew")
        bar.grid_columnconfigure(1, weight=1)
        btn(bar, "← Back", self._show_home,
            bg=t["HDR_BTN"], fg=t["TEXT"]).grid(row=0, column=0, padx=(16,0))
        title_lbl = tk.Label(bar, text="🎌 Anime Downloader",
                             bg=t["CARD"], fg=t["ACCENT"], font=F_MD, cursor="hand2")
        title_lbl.grid(row=0, column=1, sticky="w", padx=16)
        title_lbl.bind("<Button-1>", lambda e: self._show_home())

        ctrl = tk.Frame(bar, bg=t["CARD"])
        ctrl.grid(row=0, column=2, padx=(0,16))

        self._q_theme_btn = btn(ctrl, "🌙", self._toggle_theme,
                                bg=t["HDR_BTN"], fg=t["TEXT"], px=10)
        self._q_theme_btn.pack(side="left", padx=(0,6))

        btn(ctrl, "⚙", self._show_settings,
            bg=t["HDR_BTN"], fg=t["TEXT"], px=10).pack(side="left", padx=(0,6))

        btn(ctrl, "Clear All", self._clear_queue,
            bg=t["DANGER"]).pack(side="left")
        tk.Frame(parent, bg=t["BORDER"], height=1).grid(
            row=1, column=0, sticky="ew")

        self._queue_list = tk.Frame(parent, bg=t["BG"])
        self._queue_list.grid(row=2, column=0, sticky="nsew", padx=20, pady=16)
        self._queue_list.grid_columnconfigure(0, weight=1)

        self._queue_empty_lbl = tk.Label(
            self._queue_list,
            text="No downloads queued.\nGo search for anime and add them to queue!",
            bg=t["BG"], fg=t["SUBTEXT"], font=F, justify="center")
        self._queue_empty_lbl.grid(row=0, column=0, pady=60)

    def _refresh_queue_ui(self):
        t = self._t
        for w in self._queue_list.winfo_children():
            w.destroy()
        if not self._queue:
            tk.Label(self._queue_list,
                     text="No downloads queued.\nGo search for anime and add them to queue!",
                     bg=t["BG"], fg=t["SUBTEXT"], font=F,
                     justify="center").grid(row=0, column=0, pady=60)
            return
        for i, item in enumerate(self._queue):
            row_bg = t["CARD"] if i % 2 == 0 else t["PANEL"]
            r = tk.Frame(self._queue_list, bg=row_bg,
                         highlightthickness=1,
                         highlightbackground=t["BORDER"])
            r.grid(row=i, column=0, sticky="ew", pady=2)
            r.grid_columnconfigure(1, weight=1)
            # Status dot
            status = item.get("status", "Queued")
            dot_c = {"Queued": t["SUBTEXT"], "Downloading": t["ACCENT"],
                     "Done": t["SUCCESS"], "Error": t["DANGER"]}.get(
                status, t["SUBTEXT"])
            tk.Label(r, text="●", bg=row_bg, fg=dot_c,
                     font=("Segoe UI", 14)).grid(row=0, column=0,
                                                  padx=(12,8), pady=10)
            info = tk.Frame(r, bg=row_bg)
            info.grid(row=0, column=1, sticky="ew")
            tk.Label(info, text=item.get("title","Unknown"),
                     bg=row_bg, fg=t["TEXT"], font=F_BOLD,
                     anchor="w").pack(anchor="w")
            ep_count = len(item.get("ep_vars", []))
            sel = sum(1 for v,*_ in item.get("ep_vars",[]) if v.get())
            tk.Label(info, text=f"{sel} episodes selected  •  {status}",
                     bg=row_bg, fg=t["SUBTEXT"], font=F_SM,
                     anchor="w").pack(anchor="w")
            # progress bar if downloading
            if status == "Downloading":
                pv = item.get("progress_var", tk.DoubleVar())
                ttk.Progressbar(r, variable=pv, maximum=100,
                                style="A.Horizontal.TProgressbar",
                                length=200).grid(row=0, column=2,
                                                 padx=(0,10))
            btn(r, "Remove",
                lambda ii=i: self._remove_from_queue(ii),
                bg=t["DANGER"], py=4).grid(row=0, column=3, padx=(0,12))

    def _add_to_queue(self):
        if not self._ep_vars:
            messagebox.showwarning("No Episodes", "Fetch episodes first.")
            return
        selected = [(v,l,u,n) for v,l,u,n in self._ep_vars if v.get()]
        if not selected:
            messagebox.showwarning("None Selected", "Select at least one episode.")
            return
        self._queue.append({
            "title":      self._series_title,
            "url":        getattr(self, "_current_url", ""),
            "ep_vars":    list(self._ep_vars),
            "status":     "Queued",
            "progress_var": tk.DoubleVar(),
        })
        self._update_queue_badge()
        messagebox.showinfo("Added to Queue",
            f"{self._series_title} added to download queue.")

    def _remove_from_queue(self, idx):
        if 0 <= idx < len(self._queue):
            self._queue.pop(idx)
        self._update_queue_badge()
        self._refresh_queue_ui()

    def _clear_queue(self):
        self._queue.clear()
        self._update_queue_badge()
        self._refresh_queue_ui()

    def _update_queue_badge(self):
        n = len(self._queue)
        label = f"⬇ Queue ({n})"
        try:
            if hasattr(self, '_h_queue_btn'):
                self._h_queue_btn.config(text=label,
                    bg=self._t["ACCENT"] if n > 0 else self._t["HDR_BTN"])
            if hasattr(self, '_dl_queue_btn'):
                self._dl_queue_btn.config(text=label,
                    bg=self._t["ACCENT"] if n > 0 else self._t["HDR_BTN"])
        except Exception:
            pass

    # ── show settings ─────────────────────────────────────────────────────────

    def _show_settings(self):
        """Show settings as a full page overlaid on top of current page."""
        t = self._t
        # Build settings page on top
        pg = tk.Frame(self, bg=t["BG"])
        pg.grid(row=0, column=0, sticky="nsew")
        pg.tkraise()
        pg.grid_rowconfigure(1, weight=1)
        pg.grid_columnconfigure(0, weight=1)

        # ── top bar ───────────────────────────────────────────────────────────
        bar = tk.Frame(pg, bg=t["CARD"], pady=10)
        bar.grid(row=0, column=0, sticky="ew")
        bar.grid_columnconfigure(1, weight=1)
        btn(bar, "← Back", pg.destroy,
            bg=t["HDR_BTN"], fg=t["TEXT"]).grid(row=0, column=0, padx=(16,0))
        tk.Label(bar, text="Settings", bg=t["CARD"],
                 fg=t["TEXT"], font=F_MD).grid(
            row=0, column=1, sticky="w", padx=16)
        tk.Frame(pg, bg=t["BORDER"], height=1).grid(
            row=1, column=0, sticky="ew")

        # ── scrollable content ────────────────────────────────────────────────
        host = tk.Frame(pg, bg=t["BG"])
        host.grid(row=2, column=0, sticky="nsew")
        host.grid_rowconfigure(0, weight=1)
        host.grid_columnconfigure(0, weight=1)
        pg.grid_rowconfigure(2, weight=1)

        body = tk.Frame(host, bg=t["BG"])
        body.pack(padx=60, pady=40, anchor="n", fill="x")
        body.grid_columnconfigure(0, weight=1)

        # ── Downloads section ─────────────────────────────────────────────────
        sec = tk.Frame(body, bg=t["CARD"],
                       highlightthickness=1,
                       highlightbackground=t["BORDER"])
        sec.pack(fill="x", pady=(0,16))
        tk.Label(sec, text="Downloads", bg=t["CARD"],
                 fg=t["TEXT"], font=F_MD).pack(
            anchor="w", padx=20, pady=(16,8))
        tk.Frame(sec, bg=t["BORDER"], height=1).pack(fill="x")

        row1 = tk.Frame(sec, bg=t["CARD"])
        row1.pack(fill="x", padx=20, pady=12)
        tk.Label(row1, text="Max concurrent downloads",
                 bg=t["CARD"], fg=t["TEXT"], font=F,
                 width=28, anchor="w").pack(side="left")
        tv = tk.StringVar(value=str(self._max_dl))
        ttk.Combobox(row1, textvariable=tv,
                     values=["1","2","3","4","5"],
                     state="readonly", width=10,
                     font=F).pack(side="left")

        row2 = tk.Frame(sec, bg=t["CARD"])
        row2.pack(fill="x", padx=20, pady=(0,16))
        tk.Label(row2, text="Save location",
                 bg=t["CARD"], fg=t["TEXT"], font=F,
                 width=28, anchor="w").pack(side="left")
        dir_entry = entry(row2, self._dir, t, width=36)
        dir_entry.pack(side="left", padx=(0,8))
        btn(row2, "Browse", self._browse,
            bg=t["HDR_BTN"], fg=t["TEXT"], py=5).pack(side="left")

        # ── Appearance section ────────────────────────────────────────────────
        sec2 = tk.Frame(body, bg=t["CARD"],
                        highlightthickness=1,
                        highlightbackground=t["BORDER"])
        sec2.pack(fill="x", pady=(0,16))
        tk.Label(sec2, text="Appearance", bg=t["CARD"],
                 fg=t["TEXT"], font=F_MD).pack(
            anchor="w", padx=20, pady=(16,8))
        tk.Frame(sec2, bg=t["BORDER"], height=1).pack(fill="x")

        row3 = tk.Frame(sec2, bg=t["CARD"])
        row3.pack(fill="x", padx=20, pady=12)
        tk.Label(row3, text="Theme",
                 bg=t["CARD"], fg=t["TEXT"], font=F,
                 width=28, anchor="w").pack(side="left")
        cur = "Dark" if self._t is DARK else "Light"
        tk.Label(row3, text=f"Currently: {cur}",
                 bg=t["CARD"], fg=t["SUBTEXT"], font=F_SM).pack(
            side="left", padx=(0,12))
        btn(row3, "Toggle Theme", lambda: (pg.destroy(), self._toggle_theme()),
            bg=t["ACCENT"], py=5).pack(side="left")
        tk.Frame(sec2, bg=t["BG"], height=4).pack()

        # ── Cloudflare section ────────────────────────────────────────────────
        sec3 = tk.Frame(body, bg=t["CARD"],
                        highlightthickness=1,
                        highlightbackground=t["BORDER"])
        sec3.pack(fill="x", pady=(0,16))
        tk.Label(sec3, text="Cloudflare Bypass", bg=t["CARD"],
                 fg=t["TEXT"], font=F_MD).pack(
            anchor="w", padx=20, pady=(16,8))
        tk.Frame(sec3, bg=t["BORDER"], height=1).pack(fill="x")

        fs_ok  = _flaresolverr.is_running()
        cached = _sess._get_cached("https://animepahe.pw")
        age_h  = (time.time() - _sess._cookie_ts.get("animepahe",0))/3600
        cf_status = (f"✓ Cookies cached ({age_h:.1f}h old)"
                     if cached.get("cf_clearance")
                     else "✗ No cached cookies")
        fs_status = "✓ Running" if fs_ok else "✗ Not running"

        for lbl, val, ok in [
            ("FlareSolverr",  fs_status,  fs_ok),
            ("CF Cookies",    cf_status,  bool(cached.get("cf_clearance"))),
        ]:
            r = tk.Frame(sec3, bg=t["CARD"])
            r.pack(fill="x", padx=20, pady=6)
            tk.Label(r, text=lbl, bg=t["CARD"], fg=t["TEXT"],
                     font=F, width=20, anchor="w").pack(side="left")
            tk.Label(r, text=val,
                     bg=t["CARD"],
                     fg=t["SUCCESS"] if ok else t["DANGER"],
                     font=F_SM).pack(side="left")

        def _force_solve():
            solve_btn.config(state="disabled", text="Solving…")
            def _t():
                try:
                    _flaresolverr.ensure_running()
                    _sess.solve_cf_once(url="https://animepahe.pw",
                                        force=True, log_fn=self._log_dim)
                except Exception:
                    pass
                self.after(0, lambda: solve_btn.config(
                    state="normal", text="Re-solve CF Now"))
            threading.Thread(target=_t, daemon=True).start()

        r4 = tk.Frame(sec3, bg=t["CARD"])
        r4.pack(fill="x", padx=20, pady=(4,16))
        solve_btn = btn(r4, "Re-solve CF Now", _force_solve,
                        bg="#7c3aed", py=6)
        solve_btn.pack(side="left")

        # ── Save button ───────────────────────────────────────────────────────
        save_row = tk.Frame(body, bg=t["BG"])
        save_row.pack(fill="x", pady=(8,0))
        btn(save_row, "Save & Close",
            lambda: (setattr(self, "_max_dl", int(tv.get())), pg.destroy()),
            bg=t["ACCENT"], font=F_BOLD, px=20, py=10).pack(side="right")


# ── patch _open_anime to store current url ────────────────────────────────────
_orig_open = App._open_anime
def _patched_open(self, url, meta=None):
    self._current_url = url
    _orig_open(self, url, meta)
App._open_anime = _patched_open


if __name__ == "__main__":
    app = App()
    app.mainloop()
