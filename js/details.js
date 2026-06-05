// Details page JavaScript
const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    if (settings.theme === 'dark') document.body.classList.add('dark');

    const backBtn           = document.getElementById('back-to-home');
    const animeTitle        = document.getElementById('anime-title');
    const animeEpisodes     = document.getElementById('anime-episodes');
    const animeDescription  = document.getElementById('anime-description');
    const animePoster       = document.getElementById('anime-poster');
    const episodesContainer = document.getElementById('episodes-container');
    const downloadAllBtn    = document.getElementById('download-all');
    const qualityBtns       = document.querySelectorAll('.quality-btn');
    const loader            = document.getElementById('loader');
    const loaderMsg         = document.getElementById('loader-msg');

    let selectedQuality = '720p';
    let selectedAudio   = 'jp';       // default: Japanese sub
    let animeData       = null;
    // Map episodeNumber → downloadId (for tracking progress)
    const downloadIds   = {};

    // ── Loader ─────────────────────────────────────────────────────────────────
    function showLoader(msg = 'Loading...') {
        if (loaderMsg) loaderMsg.textContent = msg;
        loader.classList.add('active');
    }
    function hideLoader() { loader.classList.remove('active'); }

    // ── URL params ─────────────────────────────────────────────────────────────
    function getParam(key) {
        return new URLSearchParams(window.location.search).get(key);
    }

    // ── Load anime details ─────────────────────────────────────────────────────
    async function loadAnimeDetails() {
        showLoader('Loading anime details...');

        const animeId  = getParam('id');
        const animeUrl = getParam('url');

        // First try: check if selectedAnime was already stored by results/home page
        const stored = JSON.parse(localStorage.getItem('selectedAnime') || 'null');

        if (stored && (stored.id === animeId || stored.sourceUrl === animeUrl)) {
            animeData = {
                id:          stored.id || stored.session,
                title:       stored.title,
                episodes:    parseInt(stored.episodes) || 0,
                description: stored.description || '',
                poster:      stored.poster || '',
                session:     stored.session || stored.id,
                sourceUrl:   stored.sourceUrl || (animeId ? `https://animepahe.pw/anime/${animeId}` : animeUrl),
                episodeList: []
            };
            renderHeader();
        } else if (animeId) {
            // Fetch from API by ID
            try {
                const result = await ipcRenderer.invoke('fetch-anime-info', animeId);
                if (!result.success) throw new Error(result.message);
                const info = result.data;
                animeData = {
                    id:          info.id || animeId,
                    title:       info.title || 'Unknown',
                    episodes:    parseInt(info.episodes) || 0,
                    description: info.description || '',
                    poster:      info.poster || '',
                    session:     info.session || animeId,
                    sourceUrl:   `https://animepahe.pw/anime/${animeId}`,
                    episodeList: []
                };
                renderHeader();
            } catch (e) {
                console.error('Failed to fetch anime info:', e);
                animeTitle.textContent      = 'Error loading anime';
                animeDescription.textContent = `Failed: ${e.message}`;
                hideLoader();
                return;
            }
        } else {
            animeTitle.textContent      = 'Anime not found';
            animeDescription.textContent = 'Please search from the home page.';
            hideLoader();
            return;
        }

        await loadEpisodes();
    }

    function renderHeader() {
        animeTitle.textContent       = animeData.title;
        animeEpisodes.textContent    = animeData.episodes
            ? `${animeData.episodes} Episodes`
            : 'Episodes loading...';
        if (animeDescription) animeDescription.textContent = animeData.description || 'No description available.';

        if (animeData.poster) {
            animePoster.innerHTML = `<img src="${animeData.poster}" alt="${animeData.title}"
                style="width:100%;height:100%;object-fit:cover;border-radius:12px;"
                onerror="this.parentElement.innerHTML='<svg width=80 height=80 viewBox=&quot;0 0 24 24&quot; fill=none stroke=currentColor stroke-width=1><rect x=3 y=3 width=18 height=18 rx=2/></svg>'"
            >`;
        }
    }

    // ── Load episodes ──────────────────────────────────────────────────────────
    async function loadEpisodes() {
        episodesContainer.innerHTML = '<p style="color:var(--gray-400);text-align:center;padding:24px;">Fetching episode list...</p>';

        const url      = animeData.sourceUrl;
        const total    = animeData.episodes;

        if (!url) {
            episodesContainer.innerHTML = '<p style="color:var(--error);text-align:center;padding:24px;">Cannot determine anime URL.</p>';
            hideLoader();
            return;
        }

        if (!total || total === 0) {
            // Try to get count from API before giving up
            try {
                const metaResult = await ipcRenderer.invoke('fetch-anime-metadata', url, true);
                if (metaResult.success) {
                    animeData.episodes = parseInt(metaResult.data.episode_count) || 0;
                    animeEpisodes.textContent = `${animeData.episodes} Episodes`;
                }
            } catch (_) {}
        }

        if (!animeData.episodes || animeData.episodes === 0) {
            episodesContainer.innerHTML = '<p style="color:var(--gray-400);text-align:center;padding:24px;">No episodes available or episode count unknown.</p>';
            hideLoader();
            return;
        }

        showLoader(`Fetching ${animeData.episodes} episode links...`);

        try {
            const result = await ipcRenderer.invoke('fetch-episode-links', url, [1, animeData.episodes]);
            if (!result.success) throw new Error(result.message);

            const links = result.data;
            animeData.episodeList = links.map((link, i) => ({ number: i + 1, link }));
            animeEpisodes.textContent = `${animeData.episodeList.length} Episodes`;

            renderEpisodes();
        } catch (e) {
            console.error('Failed to load episodes:', e);
            episodesContainer.innerHTML = `<p style="color:var(--error);text-align:center;padding:24px;">Failed to load episodes: ${e.message}</p>`;
        }

        hideLoader();
    }

    // ── Render episodes ────────────────────────────────────────────────────────
    function renderEpisodes() {
        episodesContainer.innerHTML = '';
        if (!animeData.episodeList.length) {
            episodesContainer.innerHTML = '<p style="color:var(--gray-400);text-align:center;padding:24px;">No episodes found.</p>';
            return;
        }

        animeData.episodeList.forEach(ep => {
            const row = document.createElement('div');
            row.className = 'episode-row fade-in';
            row.dataset.ep = ep.number;
            row.innerHTML = `
                <span class="ep-label">Episode ${ep.number}</span>
                <div class="ep-progress-wrap" style="display:none;">
                    <div class="ep-progress-bar">
                        <div class="ep-progress-fill" style="width:0%"></div>
                    </div>
                    <span class="ep-progress-text">0%</span>
                    <span class="ep-speed-text"></span>
                </div>
                <span class="ep-status-text"></span>
                <button class="download-episode-btn" data-episode="${ep.number}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7,10 12,15 17,10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Download
                </button>
            `;
            row.querySelector('.download-episode-btn').addEventListener('click', () => downloadEpisode(ep.number, ep.link));
            episodesContainer.appendChild(row);
        });

        // Listen for download-progress events and update rows
        ipcRenderer.removeAllListeners('download-progress');
        ipcRenderer.on('download-progress', (event, { id, status, percent, speed, downloaded, total }) => {
            // Find which episode this download belongs to
            const epNum = Object.keys(downloadIds).find(k => downloadIds[k] === id);
            if (!epNum) return;
            updateEpisodeRow(parseInt(epNum), status, percent, speed, downloaded, total);
        });
    }

    // ── Update episode row with progress ───────────────────────────────────────
    function updateEpisodeRow(epNum, status, percent = 0, speed = 0, downloaded = 0, total = 0) {
        const row = episodesContainer.querySelector(`[data-ep="${epNum}"]`);
        if (!row) return;

        const progressWrap = row.querySelector('.ep-progress-wrap');
        const fill         = row.querySelector('.ep-progress-fill');
        const pText        = row.querySelector('.ep-progress-text');
        const speedText    = row.querySelector('.ep-speed-text');
        const statusText   = row.querySelector('.ep-status-text');
        const btn          = row.querySelector('.download-episode-btn');

        const fmtBytes = (b) => b > 1048576 ? `${(b/1048576).toFixed(1)} MB` : `${(b/1024).toFixed(0)} KB`;
        const fmtSpeed = (s) => s > 1048576 ? `${(s/1048576).toFixed(1)} MB/s` : `${(s/1024).toFixed(0)} KB/s`;

        switch (status) {
            case 'queued':
                progressWrap.style.display = 'flex';
                statusText.textContent     = '⏳ Queued';
                btn.disabled               = true;
                btn.textContent            = 'Queued';
                break;
            case 'downloading':
                progressWrap.style.display = 'flex';
                fill.style.width           = `${percent}%`;
                pText.textContent          = `${percent}%`;
                speedText.textContent      = speed ? ` • ${fmtSpeed(speed)}` : '';
                statusText.textContent     = total ? `${fmtBytes(downloaded)} / ${fmtBytes(total)}` : '';
                btn.disabled               = true;
                btn.textContent            = 'Downloading';
                break;
            case 'paused':
                statusText.textContent = '⏸ Paused';
                btn.disabled           = false;
                btn.textContent        = 'Resume';
                break;
            case 'done':
                progressWrap.style.display = 'flex';
                fill.style.width           = '100%';
                fill.style.background      = '#22c55e';
                pText.textContent          = '100%';
                speedText.textContent      = '';
                statusText.textContent     = '✅ Done';
                btn.disabled               = false;
                btn.textContent            = 'Downloaded';
                btn.style.background       = '#22c55e';
                break;
            case 'error':
                statusText.textContent = '❌ Error';
                btn.disabled           = false;
                btn.textContent        = 'Retry';
                break;
            case 'cancelled':
                statusText.textContent = '🚫 Cancelled';
                btn.disabled           = false;
                btn.textContent        = 'Download';
                break;
        }
    }

    // ── Download single episode ────────────────────────────────────────────────
    async function downloadEpisode(epNum, playUrl) {
        if (!playUrl) {
            alert(`No play URL for episode ${epNum}`);
            return;
        }

        const animePath = await ipcRenderer.invoke('create-anime-folder', animeData.title);

        updateEpisodeRow(epNum, 'queued');

        try {
            const result = await ipcRenderer.invoke('start-download', {
                playUrl,
                animeTitle:    animeData.title,
                episodeNumber: epNum,
                quality:       selectedQuality,
                audioLang:     selectedAudio,
                animePath
            });

            if (result.success) {
                downloadIds[epNum] = result.downloadId;
            } else {
                updateEpisodeRow(epNum, 'error');
                alert(`Failed to start download: ${result.message}`);
            }
        } catch (e) {
            console.error('Download error:', e);
            updateEpisodeRow(epNum, 'error');
            alert(`Download error: ${e.message}`);
        }
    }

    // ── Download all episodes ──────────────────────────────────────────────────
    async function downloadAllEpisodes() {
        if (!animeData || !animeData.episodeList.length) {
            alert('No episodes to download.');
            return;
        }
        if (!confirm(`Download all ${animeData.episodeList.length} episodes in ${selectedQuality}?`)) return;

        const animePath = await ipcRenderer.invoke('create-anime-folder', animeData.title);

        for (const ep of animeData.episodeList) {
            updateEpisodeRow(ep.number, 'queued');
            try {
                const result = await ipcRenderer.invoke('start-download', {
                    playUrl:       ep.link,
                    animeTitle:    animeData.title,
                    episodeNumber: ep.number,
                    quality:       selectedQuality,
                    audioLang:     selectedAudio,
                    animePath
                });
                if (result.success) downloadIds[ep.number] = result.downloadId;
                else updateEpisodeRow(ep.number, 'error');
            } catch (_) {
                updateEpisodeRow(ep.number, 'error');
            }
            // Small delay to avoid hammering
            await new Promise(r => setTimeout(r, 400));
        }
    }

    // ── Quality selection ──────────────────────────────────────────────────────
    qualityBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            qualityBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedQuality = btn.dataset.quality;
        });
    });

    // ── Event listeners ────────────────────────────────────────────────────────
    backBtn && backBtn.addEventListener('click', () => window.location.href = 'index.html');
    downloadAllBtn && downloadAllBtn.addEventListener('click', downloadAllEpisodes);

    // ── Init ───────────────────────────────────────────────────────────────────
    loadAnimeDetails();
});
