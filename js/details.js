// Details page JavaScript
document.addEventListener('DOMContentLoaded', () => {
    // Load theme from localStorage
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    if (settings.theme === 'dark') {
        document.body.classList.add('dark');
    }

    const backToHomeBtn = document.getElementById('back-to-home');
    const animeTitle = document.getElementById('anime-title');
    const animeEpisodes = document.getElementById('anime-episodes');
    const animeDescription = document.getElementById('anime-description');
    const animePoster = document.getElementById('anime-poster');
    const episodesContainer = document.getElementById('episodes-container');
    const downloadAllBtn = document.getElementById('download-all');
    const qualityBtns = document.querySelectorAll('.quality-btn');
    const loader = document.getElementById('loader');

    let selectedQuality = '720p';
    let animeData = null;

    // Show loader
    function showLoader() {
        loader.classList.add('active');
    }

    // Hide loader
    function hideLoader() {
        loader.classList.remove('active');
    }

    // Get anime ID from URL
    function getAnimeId() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('id');
    }

    // Load anime details from API
    async function loadAnimeDetails() {
        showLoader();
        const animeId = getAnimeId();
        
        if (!animeId) {
            animeTitle.textContent = 'Anime not found';
            animeEpisodes.textContent = '';
            animeDescription.textContent = 'Please search for an anime from the home page.';
            hideLoader();
            return;
        }
        
        try {
            // TODO: Replace with actual API call
            // const response = await fetch(`/api/anime/${animeId}`);
            // animeData = await response.json();
            
            // Simulate API response
            animeData = {
                id: animeId,
                title: 'Anime Title',
                episodes: 0,
                description: 'Anime description will be loaded from API.',
                poster: '',
                episodeList: []
            };
            
            animeTitle.textContent = animeData.title;
            animeEpisodes.textContent = `${animeData.episodes} Episodes`;
            animeDescription.textContent = animeData.description;
            
            if (animeData.poster) {
                animePoster.innerHTML = `<img src="${animeData.poster}" alt="${animeData.title}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 12px;">`;
            }
            
            loadEpisodes();
        } catch (error) {
            console.error('Failed to load anime details:', error);
            animeTitle.textContent = 'Error loading anime';
            animeEpisodes.textContent = '';
            animeDescription.textContent = 'Failed to load anime details. Please try again.';
        }
        
        hideLoader();
    }

    // Load episodes
    function loadEpisodes() {
        episodesContainer.innerHTML = '';
        
        if (!animeData || animeData.episodeList.length === 0) {
            episodesContainer.innerHTML = '<p style="color: var(--gray-400); font-size: 14px; text-align: center; padding: 32px;">No episodes available</p>';
            return;
        }
        
        animeData.episodeList.forEach(episode => {
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
            const animePath = await window.electron.ipcRenderer.invoke('create-anime-folder', animeData.title);
            
            // Add to download queue
            const download = {
                anime: animeData.title,
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
                animeName: animeData.title,
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
        if (!animeData || animeData.episodeList.length === 0) {
            alert('No episodes to download.');
            return;
        }
        
        if (!confirm(`Are you sure you want to download all ${animeData.episodes} episodes in ${selectedQuality}?`)) {
            return;
        }
        
        showLoader();
        
        try {
            // Create anime folder
            const animePath = await window.electron.ipcRenderer.invoke('create-anime-folder', animeData.title);
            
            // Add all episodes to download queue
            const downloads = JSON.parse(localStorage.getItem('downloads') || '[]');
            animeData.episodeList.forEach(episode => {
                downloads.push({
                    anime: animeData.title,
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
            for (const episode of animeData.episodeList) {
                await window.electron.ipcRenderer.invoke('start-download', {
                    animeName: animeData.title,
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

    // Quality selection
    qualityBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            qualityBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedQuality = btn.dataset.quality;
        });
    });

    // Event listeners
    backToHomeBtn.addEventListener('click', () => {
        window.location.href = 'index.html';
    });

    downloadAllBtn.addEventListener('click', downloadAllEpisodes);

    // Initialize
    loadAnimeDetails();
});
