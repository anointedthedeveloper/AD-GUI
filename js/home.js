// Home page JavaScript
const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    // Load theme from localStorage
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    if (settings.theme === 'dark') document.body.classList.add('dark');

    const searchInput       = document.getElementById('search-input');
    const searchBtn         = document.getElementById('search-btn');
    const urlInput          = document.getElementById('url-input');
    const pasteUrlBtn       = document.getElementById('paste-url-btn');
    const recentList        = document.getElementById('recent-list');
    const trendingGrid      = document.getElementById('trending-grid');
    const loader            = document.getElementById('loader');
    const loaderMsg         = document.getElementById('loader-msg');
    const urlPreviewSection = document.getElementById('url-preview-section');
    const previewContent    = document.getElementById('preview-content');
    const confirmUrlBtn     = document.getElementById('confirm-url');
    const cancelUrlBtn      = document.getElementById('cancel-url');
    const clearHistoryBtn   = document.getElementById('clear-history');
    const fsBadge           = document.getElementById('fs-badge');
    const fsTimer            = document.getElementById('fs-timer');

    let _solveStart  = null;
    let _solveTimerInterval = null;

    function startSolveTimer() {
        _solveStart = Date.now();
        _solveTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - _solveStart) / 1000);
            const m = Math.floor(elapsed / 60);
            const s = elapsed % 60;
            const timeStr = m > 0 ? `${m}m ${s}s` : `${s}s`;
            if (fsTimer) fsTimer.textContent = `Elapsed: ${timeStr} (can take up to 11 min)`;
        }, 1000);
    }

    function stopSolveTimer() {
        clearInterval(_solveTimerInterval);
        _solveTimerInterval = null;
        if (fsTimer) fsTimer.textContent = '';
    }

    // ── Loader ─────────────────────────────────────────────────────────────────
    function showLoader(msg = 'Loading...') {
        if (loaderMsg) loaderMsg.textContent = msg;
        loader.classList.add('active');
    }
    function hideLoader() { loader.classList.remove('active'); }

    // ── FlareSolverr status & UI blocking ─────────────────────────────────────
    let isAppReady = false;

    function setUiState(state) {
        if (!fsBadge) return;
        switch (state) {
            case 'starting':
                isAppReady = false;
                stopSolveTimer();
                fsBadge.textContent = '🟡 Starting CF Bypass...';
                fsBadge.style.color = '#f59e0b';
                searchInput.disabled = true; searchBtn.disabled = true;
                urlInput.disabled = true; pasteUrlBtn.disabled = true;
                break;
            case 'solving':
                isAppReady = false;
                startSolveTimer();
                fsBadge.textContent = '🟠 Solving Cloudflare... (Takes up to 11 min)';
                fsBadge.style.color = '#f97316';
                searchInput.disabled = true; searchBtn.disabled = true;
                urlInput.disabled = true; pasteUrlBtn.disabled = true;
                break;
            case 'ready':
                isAppReady = true;
                stopSolveTimer();
                fsBadge.textContent = '🟢 CF Bypassed (Valid 7 days)';
                fsBadge.style.color = '#22c55e';
                searchInput.disabled = false; searchBtn.disabled = false;
                urlInput.disabled = false; pasteUrlBtn.disabled = false;
                break;
            case 'error':
                isAppReady = false;
                stopSolveTimer();
                fsBadge.textContent = '🔴 CF Bypass Error';
                fsBadge.style.color = '#ef4444';
                searchInput.disabled = false; searchBtn.disabled = false;
                urlInput.disabled = false; pasteUrlBtn.disabled = false;
                break;
            default:
                isAppReady = false;
                stopSolveTimer();
                searchInput.disabled = true; searchBtn.disabled = true;
                urlInput.disabled = true; pasteUrlBtn.disabled = true;
                break;
        }
    }

    // Default locked state on boot
    setUiState('starting');

    ipcRenderer.on('flaresolverr-state', (e, state) => setUiState(state));

    // ── Recent searches ─────────────────────────────────────────────────────────
    function loadRecentSearches() {
        const recentSearches = JSON.parse(localStorage.getItem('recentSearches') || '[]');
        recentList.innerHTML = '';
        if (recentSearches.length === 0) {
            recentList.innerHTML = '<p style="color:var(--gray-400);font-size:14px;">No recent searches</p>';
            return;
        }
        recentSearches.forEach((search, index) => {
            const item = document.createElement('div');
            item.className = 'recent-item fade-in';
            item.innerHTML = `
                <span>${search}</span>
                <button class="delete-search-btn" data-index="${index}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            `;
            item.querySelector('span').addEventListener('click', () => {
                searchInput.value = search;
                performSearch(search);
            });
            item.querySelector('.delete-search-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                const list = JSON.parse(localStorage.getItem('recentSearches') || '[]');
                list.splice(index, 1);
                localStorage.setItem('recentSearches', JSON.stringify(list));
                loadRecentSearches();
            });
            recentList.appendChild(item);
        });
    }

    function clearSearchHistory() {
        if (!confirm('Clear all search history?')) return;
        localStorage.removeItem('recentSearches');
        loadRecentSearches();
    }

    // ── Trending (placeholder — API has no trending endpoint) ──────────────────
    function loadTrendingAnime() {
        trendingGrid.innerHTML = '<p style="color:var(--gray-400);font-size:14px;grid-column:1/-1;text-align:center;">Search for anime to get started</p>';
    }

    // ── Search ──────────────────────────────────────────────────────────────────
    async function performSearch(query) {
        if (!isAppReady && fsBadge.textContent !== '🔴 CF Bypass Error') {
            alert('Please wait for Cloudflare bypass to finish solving.');
            return;
        }
        if (!query.trim()) return;

        // Save to recent searches
        const recents = JSON.parse(localStorage.getItem('recentSearches') || '[]');
        if (!recents.includes(query)) {
            recents.unshift(query);
            if (recents.length > 10) recents.pop();
            localStorage.setItem('recentSearches', JSON.stringify(recents));
        }
        loadRecentSearches();

        showLoader(`Searching for "${query}"...`);

        try {
            const result = await ipcRenderer.invoke('search-anime', query);
            if (result.success && result.data.length > 0) {
                localStorage.setItem('searchResults', JSON.stringify(result.data));
                localStorage.setItem('searchQuery', query);
                window.location.href = `results.html?q=${encodeURIComponent(query)}`;
            } else if (result.success) {
                hideLoader();
                alert('No anime found. Try a different search term.');
            } else {
                hideLoader();
                alert(`Search failed: ${result.message}`);
            }
        } catch (e) {
            console.error('Search error:', e);
            hideLoader();
            alert('Search failed. Please check your connection and try again.');
        }
    }

    // ── URL paste ───────────────────────────────────────────────────────────────
    async function handlePasteUrl() {
        try {
            const text = await navigator.clipboard.readText();
            urlInput.value = text;
            showUrlPreview(text);
        } catch (_) {
            alert('Failed to read clipboard. Please paste manually.');
        }
    }

    urlInput.addEventListener('input', () => {
        const v = urlInput.value.trim();
        if (v.startsWith('https://animepahe.')) showUrlPreview(v);
        else urlPreviewSection.style.display = 'none';
    });

    function showUrlPreview(url) {
        const isValid = /animepahe\.(com|org|ru|si|pw)\/(anime|play)\//.test(url);
        previewContent.innerHTML = `
            <div style="text-align:center;">
                <p style="margin-bottom:8px;font-weight:500;">URL detected:</p>
                <p style="word-break:break-all;color:var(--primary-blue);">${url}</p>
                ${isValid
                    ? '<p style="margin-top:12px;font-size:12px;color:#22c55e;">✔ Valid AnimePahe URL</p>'
                    : '<p style="margin-top:12px;font-size:12px;color:#f59e0b;">⚠ This URL may not be a valid AnimePahe series URL</p>'
                }
            </div>
        `;
        urlPreviewSection.style.display = 'block';
        urlPreviewSection.scrollIntoView({ behavior: 'smooth' });
    }

    // ── Confirm URL — fetch real metadata and navigate ─────────────────────────
    async function confirmUrl() {
        if (!isAppReady && fsBadge.textContent !== '🔴 CF Bypass Error') {
            alert('Please wait for Cloudflare bypass to finish solving.');
            return;
        }
        const url = urlInput.value.trim();
        if (!url) return;

        urlPreviewSection.style.display = 'none';
        showLoader('Fetching anime info from URL...');

        try {
            const isSeries = /\/anime\//.test(url);
            const result   = await ipcRenderer.invoke('fetch-anime-metadata', url, isSeries);

            if (!result.success) {
                hideLoader();
                alert(`Failed to load anime: ${result.message}`);
                return;
            }

            const meta = result.data;

            if (isSeries && meta.id) {
                // Navigate to details page with the anime session id
                localStorage.setItem('selectedAnime', JSON.stringify({
                    id: meta.id || meta.session,
                    title: meta.title,
                    episodes: meta.episode_count,
                    poster: meta.poster,
                    session: meta.session,
                    sourceUrl: url
                }));
                hideLoader();
                window.location.href = `details.html?id=${encodeURIComponent(meta.id || meta.session)}&url=${encodeURIComponent(url)}`;
            } else if (isSeries && meta.title) {
                // Scraped fallback — no id, but we have the URL
                localStorage.setItem('selectedAnime', JSON.stringify({
                    title: meta.title,
                    episodes: meta.episode_count,
                    poster: meta.poster,
                    sourceUrl: url
                }));
                hideLoader();
                window.location.href = `details.html?url=${encodeURIComponent(url)}`;
            } else {
                hideLoader();
                alert('Could not extract anime info from that URL. Make sure it is a valid AnimePahe series URL.');
            }
        } catch (e) {
            console.error('confirmUrl error:', e);
            hideLoader();
            alert(`Error loading URL: ${e.message}`);
        }
    }

    function cancelUrl() {
        urlPreviewSection.style.display = 'none';
        urlInput.value = '';
    }

    // ── Event listeners ────────────────────────────────────────────────────────
    searchBtn.addEventListener('click', () => performSearch(searchInput.value));
    searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') performSearch(searchInput.value); });
    pasteUrlBtn.addEventListener('click', handlePasteUrl);
    clearHistoryBtn && clearHistoryBtn.addEventListener('click', clearSearchHistory);
    confirmUrlBtn.addEventListener('click', confirmUrl);
    cancelUrlBtn.addEventListener('click', cancelUrl);

    // ── Init ───────────────────────────────────────────────────────────────────
    loadRecentSearches();
    loadTrendingAnime();
});
