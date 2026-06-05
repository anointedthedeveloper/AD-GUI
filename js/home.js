// Home page JavaScript
document.addEventListener('DOMContentLoaded', () => {
    // Load theme from localStorage
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    if (settings.theme === 'dark') {
        document.body.classList.add('dark');
    }

    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const urlInput = document.getElementById('url-input');
    const pasteUrlBtn = document.getElementById('paste-url-btn');
    const recentList = document.getElementById('recent-list');
    const trendingGrid = document.getElementById('trending-grid');
    const loader = document.getElementById('loader');
    const animeDetailsSection = document.getElementById('anime-details-section');
    const animeTitle = document.getElementById('anime-title');
    const animeEpisodes = document.getElementById('anime-episodes');
    const animeDescription = document.getElementById('anime-description');
    const animePoster = document.getElementById('anime-poster');
    const episodesContainer = document.getElementById('episodes-container');
    const downloadAllBtn = document.getElementById('download-all');
    const closeDetailsBtn = document.getElementById('close-details');
    const qualityBtns = document.querySelectorAll('.quality-btn');
    const clearHistoryBtn = document.getElementById('clear-history');
    const urlPreviewSection = document.getElementById('url-preview-section');
    const previewContent = document.getElementById('preview-content');
    const confirmUrlBtn = document.getElementById('confirm-url');
    const cancelUrlBtn = document.getElementById('cancel-url');

    let selectedQuality = '720p';
    let currentAnimeData = null;

    // Show loader
    function showLoader() {
        loader.classList.add('active');
    }

    // Hide loader
    function hideLoader() {
        loader.classList.remove('active');
    }

    // Load recent searches from localStorage or API
    function loadRecentSearches() {
        showLoader();
        const recentSearches = JSON.parse(localStorage.getItem('recentSearches') || '[]');
        
        recentList.innerHTML = '';
        
        if (recentSearches.length === 0) {
            recentList.innerHTML = '<p style="color: var(--gray-400); font-size: 14px;">No recent searches</p>';
        } else {
            recentSearches.forEach((search, index) => {
                const item = document.createElement('div');
                item.className = 'recent-item fade-in';
                item.innerHTML = `
                    <span>${search}</span>
                    <button class="delete-search-btn" data-index="${index}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                `;
                
                // Click on search to search
                item.querySelector('span').addEventListener('click', () => {
                    searchInput.value = search;
                    performSearch(search);
                });
                
                // Click on delete button to remove
                item.querySelector('.delete-search-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteRecentSearch(index);
                });
                
                recentList.appendChild(item);
            });
        }
        
        hideLoader();
    }

    // Delete individual recent search
    function deleteRecentSearch(index) {
        const recentSearches = JSON.parse(localStorage.getItem('recentSearches') || '[]');
        recentSearches.splice(index, 1);
        localStorage.setItem('recentSearches', JSON.stringify(recentSearches));
        loadRecentSearches();
    }

    // Clear all search history
    function clearSearchHistory() {
        if (!confirm('Are you sure you want to clear all search history?')) return;
        localStorage.removeItem('recentSearches');
        loadRecentSearches();
    }

    // Load trending anime from API
    function loadTrendingAnime() {
        showLoader();
        // TODO: Replace with actual API call
        const trendingAnime = []; // Will be populated from API
        
        trendingGrid.innerHTML = '';
        
        if (trendingAnime.length === 0) {
            trendingGrid.innerHTML = '<p style="color: var(--gray-400); font-size: 14px; grid-column: 1/-1; text-align: center;">No trending anime available</p>';
        } else {
            trendingAnime.forEach(anime => {
                const card = document.createElement('div');
                card.className = 'trending-card fade-in';
                card.innerHTML = `
                    <div class="card-image">
                        <div class="placeholder-image">${anime.initials || 'AN'}</div>
                    </div>
                    <div class="card-info">
                        <h4>${anime.title}</h4>
                        <p>${anime.episodes} Episodes</p>
                    </div>
                `;
                card.addEventListener('click', () => {
                    fetchAnimeDetails(anime.id);
                });
                trendingGrid.appendChild(card);
            });
        }
        
        hideLoader();
    }

    // Fetch anime details from API
    async function fetchAnimeDetails(animeId) {
        showLoader();
        
        try {
            // TODO: Replace with actual API call
            // const response = await fetch(`/api/anime/${animeId}`);
            // currentAnimeData = await response.json();
            
            // Simulate API response
            currentAnimeData = {
                id: animeId,
                title: 'Anime Title',
                episodes: 0,
                description: 'Anime description will be loaded from API.',
                poster: '',
                episodeList: []
            };
            
            animeTitle.textContent = currentAnimeData.title;
            animeEpisodes.textContent = `${currentAnimeData.episodes} Episodes`;
            animeDescription.textContent = currentAnimeData.description;
            
            if (currentAnimeData.poster) {
                animePoster.innerHTML = `<img src="${currentAnimeData.poster}" alt="${currentAnimeData.title}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 12px;">`;
            }
            
            loadEpisodes();
            animeDetailsSection.style.display = 'block';
            animeDetailsSection.scrollIntoView({ behavior: 'smooth' });
        } catch (error) {
            console.error('Failed to fetch anime details:', error);
            alert('Failed to load anime details. Please try again.');
        }
        
        hideLoader();
    }

    // Load episodes
    function loadEpisodes() {
        episodesContainer.innerHTML = '';
        
        if (!currentAnimeData || currentAnimeData.episodeList.length === 0) {
            episodesContainer.innerHTML = '<p style="color: var(--gray-400); font-size: 14px; text-align: center; padding: 32px;">No episodes available</p>';
            return;
        }
        
        currentAnimeData.episodeList.forEach(episode => {
            const row = document.createElement('div');
            row.className = 'episode-row fade-in';
            row.innerHTML = `
                <span>Episode ${episode.number}</span>
                <button class="download-episode-btn" data-episode="${episode.number}">Download</button>
            `;
            
            row.querySelector('.download-episode-btn').addEventListener('click', () => {
                downloadEpisode(episode.number);
            });
            
            episodesContainer.appendChild(row);
        });
    }

    // Download single episode
    async function downloadEpisode(episodeNumber) {
        showLoader();
        
        try {
            // Create anime folder
            const animePath = await window.electron.ipcRenderer.invoke('create-anime-folder', currentAnimeData.title);
            
            // Add to download queue
            const download = {
                anime: currentAnimeData.title,
                episode: episodeNumber,
                quality: selectedQuality,
                size: 'Calculating...',
                progress: 0,
                speed: '0 MB/s',
                id: Date.now(),
                animePath: animePath
            };
            
            // Save to download queue
            const downloads = JSON.parse(localStorage.getItem('downloads') || '[]');
            downloads.push(download);
            localStorage.setItem('downloads', JSON.stringify(downloads));
            
            // Start download via Electron
            await window.electron.ipcRenderer.invoke('start-download', {
                animeName: currentAnimeData.title,
                episodeNumber: episodeNumber,
                quality: selectedQuality,
                animePath: animePath
            });
            
            setTimeout(() => {
                hideLoader();
                alert(`Episode ${episodeNumber} added to download queue!`);
            }, 500);
        } catch (error) {
            console.error('Failed to download episode:', error);
            hideLoader();
            alert('Failed to start download. Please try again.');
        }
    }

    // Download all episodes
    async function downloadAllEpisodes() {
        if (!currentAnimeData || currentAnimeData.episodeList.length === 0) {
            alert('No episodes to download.');
            return;
        }
        
        if (!confirm(`Are you sure you want to download all ${currentAnimeData.episodes} episodes in ${selectedQuality}?`)) {
            return;
        }
        
        showLoader();
        
        try {
            // Create anime folder
            const animePath = await window.electron.ipcRenderer.invoke('create-anime-folder', currentAnimeData.title);
            
            // Add all episodes to download queue
            const downloads = JSON.parse(localStorage.getItem('downloads') || '[]');
            currentAnimeData.episodeList.forEach(episode => {
                downloads.push({
                    anime: currentAnimeData.title,
                    episode: episode.number,
                    quality: selectedQuality,
                    size: 'Calculating...',
                    progress: 0,
                    speed: '0 MB/s',
                    id: Date.now() + episode.number,
                    animePath: animePath
                });
            });
            localStorage.setItem('downloads', JSON.stringify(downloads));
            
            // Start downloads via Electron
            for (const episode of currentAnimeData.episodeList) {
                await window.electron.ipcRenderer.invoke('start-download', {
                    animeName: currentAnimeData.title,
                    episodeNumber: episode.number,
                    quality: selectedQuality,
                    animePath: animePath
                });
            }
            
            setTimeout(() => {
                hideLoader();
                alert(`All episodes added to download queue!`);
            }, 500);
        } catch (error) {
            console.error('Failed to download all episodes:', error);
            hideLoader();
            alert('Failed to start downloads. Please try again.');
        }
    }

    // Perform search
    async function performSearch(query) {
        if (!query.trim()) return;
        
        showLoader();
        
        // Save to recent searches
        const recentSearches = JSON.parse(localStorage.getItem('recentSearches') || '[]');
        if (!recentSearches.includes(query)) {
            recentSearches.unshift(query);
            if (recentSearches.length > 10) recentSearches.pop();
            localStorage.setItem('recentSearches', JSON.stringify(recentSearches));
        }
        
        // Reload recent searches
        loadRecentSearches();
        
        try {
            const result = await window.electron.ipcRenderer.invoke('search-anime', query);
            
            if (result.success && result.data.length > 0) {
                // Store results in localStorage for results page
                localStorage.setItem('searchResults', JSON.stringify(result.data));
                localStorage.setItem('searchQuery', query);
                
                // Navigate to results page
                window.location.href = `results.html?q=${encodeURIComponent(query)}`;
            } else {
                alert('No anime found. Please try a different search term.');
                hideLoader();
            }
        } catch (error) {
            console.error('Failed to search anime:', error);
            alert('Failed to search anime. Please try again.');
            hideLoader();
        }
    }

    // Handle URL paste
    async function handlePasteUrl() {
        try {
            const text = await navigator.clipboard.readText();
            urlInput.value = text;
            
            // Show URL preview
            showUrlPreview(text);
        } catch (err) {
            console.error('Failed to read clipboard:', err);
            alert('Failed to paste from clipboard. Please paste manually.');
        }
    }

    // Show URL preview
    function showUrlPreview(url) {
        previewContent.innerHTML = `
            <div style="text-align: center;">
                <p style="margin-bottom: 8px; font-weight: 500;">URL detected:</p>
                <p style="word-break: break-all; color: var(--primary-blue);">${url}</p>
                <p style="margin-top: 16px; font-size: 12px;">Click "Confirm & Load" to fetch anime details from this URL</p>
            </div>
        `;
        urlPreviewSection.style.display = 'block';
        urlPreviewSection.scrollIntoView({ behavior: 'smooth' });
    }

    // Confirm URL and load anime
    async function confirmUrl() {
        const url = urlInput.value;
        if (!url) return;
        
        urlPreviewSection.style.display = 'none';
        
        // TODO: Parse URL and fetch anime details
        console.log('Loading anime from URL:', url);
        
        showLoader();
        setTimeout(() => {
            currentAnimeData = {
                id: 'url-result',
                title: 'Anime from URL',
                episodes: 0,
                description: 'Anime description will be loaded from API.',
                poster: '',
                episodeList: []
            };
            
            animeTitle.textContent = currentAnimeData.title;
            animeEpisodes.textContent = `${currentAnimeData.episodes} Episodes`;
            animeDescription.textContent = currentAnimeData.description;
            
            loadEpisodes();
            animeDetailsSection.style.display = 'block';
            animeDetailsSection.scrollIntoView({ behavior: 'smooth' });
            hideLoader();
        }, 1000);
    }

    // Cancel URL preview
    function cancelUrl() {
        urlPreviewSection.style.display = 'none';
        urlInput.value = '';
    }

    // Quality selection
    qualityBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            qualityBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedQuality = btn.dataset.quality;
        });
    });

    // Event listeners
    searchBtn.addEventListener('click', () => {
        performSearch(searchInput.value);
    });

    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performSearch(searchInput.value);
        }
    });

    pasteUrlBtn.addEventListener('click', handlePasteUrl);
    downloadAllBtn.addEventListener('click', downloadAllEpisodes);
    closeDetailsBtn.addEventListener('click', () => {
        animeDetailsSection.style.display = 'none';
    });
    clearHistoryBtn.addEventListener('click', clearSearchHistory);
    confirmUrlBtn.addEventListener('click', confirmUrl);
    cancelUrlBtn.addEventListener('click', cancelUrl);

    // Initialize
    loadRecentSearches();
    loadTrendingAnime();
});
