// Downloads page JavaScript
const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    if (settings.theme === 'dark') document.body.classList.add('dark');

    const downloadsList  = document.getElementById('downloads-list');
    const emptyDownloads = document.getElementById('empty-downloads');
    const loader         = document.getElementById('loader');

    function showLoader() { loader.classList.add('active'); }
    function hideLoader() { loader.classList.remove('active'); }

    // ── Format helpers ─────────────────────────────────────────────────────────
    function fmtBytes(b) {
        if (!b) return '0 KB';
        return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`;
    }
    function fmtSpeed(s) {
        if (!s) return '';
        return s > 1048576 ? `${(s / 1048576).toFixed(1)} MB/s` : `${(s / 1024).toFixed(0)} KB/s`;
    }

    // ── Render all downloads from IPC ─────────────────────────────────────────
    async function loadDownloads() {
        try {
            const result = await ipcRenderer.invoke('get-downloads');
            const downloads = (result.success ? result.data : []);

            downloadsList.innerHTML = '';

            if (downloads.length === 0) {
                downloadsList.style.display = 'none';
                emptyDownloads.style.display = 'flex';
                return;
            }

            downloadsList.style.display = 'flex';
            emptyDownloads.style.display = 'none';

            downloads.forEach(dl => renderDownloadItem(dl));
        } catch (e) {
            console.error('Failed to load downloads:', e);
        }
    }

    function renderDownloadItem(dl) {
        // Avoid duplicate rows
        if (downloadsList.querySelector(`[data-id="${dl.id}"]`)) return;

        const item = document.createElement('div');
        item.className = 'download-item fade-in';
        item.dataset.id = dl.id;

        const isPaused = dl.status === 'paused';
        const isDone   = dl.status === 'done';
        const isQueued = dl.status === 'queued';

        item.innerHTML = `
            <div class="download-info">
                <h4>${dl.animeTitle} EP ${dl.episodeNumber}</h4>
                <p>${dl.quality} • <span class="dl-size">${dl.total ? fmtBytes(dl.total) : 'Calculating...'}</span></p>
                <p class="dl-dest" style="font-size:11px;color:var(--gray-400);word-break:break-all;">${dl.destPath || ''}</p>
            </div>
            <div class="download-progress">
                <div class="progress-bar">
                    <div class="progress-fill" style="width:${dl.percent || 0}%;${isDone ? 'background:#22c55e' : ''}"></div>
                </div>
                <span class="progress-text">${dl.percent || 0}%</span>
            </div>
            <div class="download-speed dl-speed">${isQueued ? '⏳ Queued' : isPaused ? '⏸ Paused' : isDone ? '✅ Done' : ''}</div>
            <div class="download-actions">
                <button class="action-btn pause-btn" title="Pause" data-id="${dl.id}" style="${isPaused || isDone || isQueued ? 'display:none' : ''}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
                    </svg>
                </button>
                <button class="action-btn resume-btn" title="Resume" data-id="${dl.id}" style="${!isPaused ? 'display:none' : ''}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="5,3 19,12 5,21"/>
                    </svg>
                </button>
                <button class="action-btn cancel-btn" title="Cancel" data-id="${dl.id}" ${isDone ? 'disabled' : ''}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
        `;

        item.querySelector('.pause-btn').addEventListener('click', () => pauseDownload(dl.id, item));
        item.querySelector('.resume-btn').addEventListener('click', () => resumeDownload(dl.id, item));
        item.querySelector('.cancel-btn').addEventListener('click', () => cancelDownload(dl.id, item));

        downloadsList.appendChild(item);
    }

    // ── Update a row from a progress event ────────────────────────────────────
    function updateRow(id, { status, percent = 0, speed = 0, downloaded = 0, total = 0 }) {
        const item = downloadsList.querySelector(`[data-id="${id}"]`);
        if (!item) { loadDownloads(); return; } // new item, re-render

        const fill      = item.querySelector('.progress-fill');
        const pText     = item.querySelector('.progress-text');
        const speedEl   = item.querySelector('.dl-speed');
        const sizeEl    = item.querySelector('.dl-size');
        const pauseBtn  = item.querySelector('.pause-btn');
        const resumeBtn = item.querySelector('.resume-btn');
        const cancelBtn = item.querySelector('.cancel-btn');

        if (fill)  fill.style.width = `${percent}%`;
        if (pText) pText.textContent = `${percent}%`;
        if (sizeEl && total) sizeEl.textContent = fmtBytes(total);

        switch (status) {
            case 'downloading':
                if (speedEl) speedEl.textContent = speed ? fmtSpeed(speed) : '';
                if (pauseBtn)  pauseBtn.style.display = '';
                if (resumeBtn) resumeBtn.style.display = 'none';
                break;
            case 'paused':
                if (speedEl)   speedEl.textContent = '⏸ Paused';
                if (pauseBtn)  pauseBtn.style.display = 'none';
                if (resumeBtn) resumeBtn.style.display = '';
                break;
            case 'done':
                if (fill)      { fill.style.width = '100%'; fill.style.background = '#22c55e'; }
                if (speedEl)   speedEl.textContent = '✅ Done';
                if (pauseBtn)  pauseBtn.style.display = 'none';
                if (resumeBtn) resumeBtn.style.display = 'none';
                if (cancelBtn) cancelBtn.disabled = true;
                break;
            case 'error':
                if (speedEl) speedEl.textContent = '❌ Error';
                break;
            case 'cancelled':
                item.style.animation = 'fadeOut 0.4s ease forwards';
                setTimeout(() => {
                    item.remove();
                    if (!downloadsList.children.length) {
                        downloadsList.style.display = 'none';
                        emptyDownloads.style.display = 'flex';
                    }
                }, 400);
                break;
        }
    }

    // ── Actions ────────────────────────────────────────────────────────────────
    async function pauseDownload(id, item) {
        await ipcRenderer.invoke('pause-download', id);
        const speedEl  = item.querySelector('.dl-speed');
        const pauseBtn = item.querySelector('.pause-btn');
        const resumeBtn = item.querySelector('.resume-btn');
        if (speedEl)   speedEl.textContent = '⏸ Paused';
        if (pauseBtn)  pauseBtn.style.display = 'none';
        if (resumeBtn) resumeBtn.style.display = '';
    }

    async function resumeDownload(id, item) {
        await ipcRenderer.invoke('resume-download', id);
        const pauseBtn  = item.querySelector('.pause-btn');
        const resumeBtn = item.querySelector('.resume-btn');
        const speedEl   = item.querySelector('.dl-speed');
        if (pauseBtn)  pauseBtn.style.display = '';
        if (resumeBtn) resumeBtn.style.display = 'none';
        if (speedEl)   speedEl.textContent = '';
    }

    async function cancelDownload(id, item) {
        if (!confirm('Cancel this download?')) return;
        await ipcRenderer.invoke('cancel-download', id);
        item.style.animation = 'fadeOut 0.4s ease forwards';
        setTimeout(() => {
            item.remove();
            if (!downloadsList.children.length) {
                downloadsList.style.display = 'none';
                emptyDownloads.style.display = 'flex';
            }
        }, 400);
    }

    // ── Listen for real-time progress ──────────────────────────────────────────
    ipcRenderer.on('download-progress', (event, { id, ...progress }) => {
        // If item doesn't exist yet, add it
        if (!downloadsList.querySelector(`[data-id="${id}"]`) && progress.status !== 'cancelled') {
            loadDownloads();
        } else {
            updateRow(id, progress);
        }
    });

    // ── Init ───────────────────────────────────────────────────────────────────
    showLoader();
    loadDownloads().then(hideLoader);

    // Refresh every 5 s in case of missed events
    setInterval(loadDownloads, 5000);
});
