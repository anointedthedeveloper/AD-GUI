// Downloads page JavaScript
document.addEventListener('DOMContentLoaded', () => {
    // Load theme from localStorage
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    if (settings.theme === 'dark') {
        document.body.classList.add('dark');
    }

    const downloadsList = document.getElementById('downloads-list');
    const emptyDownloads = document.getElementById('empty-downloads');
    const loader = document.getElementById('loader');

    // Show loader
    function showLoader() {
        loader.classList.add('active');
    }

    // Hide loader
    function hideLoader() {
        loader.classList.remove('active');
    }

    // Load active downloads from localStorage
    function loadDownloads() {
        showLoader();
        const downloads = JSON.parse(localStorage.getItem('downloads') || '[]');
        
        downloadsList.innerHTML = '';
        
        if (downloads.length === 0) {
            downloadsList.style.display = 'none';
            emptyDownloads.style.display = 'flex';
        } else {
            downloadsList.style.display = 'flex';
            emptyDownloads.style.display = 'none';
            
            downloads.forEach(download => {
                const item = document.createElement('div');
                item.className = 'download-item fade-in';
                item.innerHTML = `
                    <div class="download-info">
                        <h4>${download.anime} EP ${download.episode}</h4>
                        <p>${download.quality} • ${download.size}</p>
                    </div>
                    <div class="download-progress">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${download.progress}%"></div>
                        </div>
                        <span class="progress-text">${download.progress}%</span>
                    </div>
                    <div class="download-speed">${download.speed}</div>
                    <div class="download-actions">
                        <button class="action-btn pause-btn" title="Pause" data-id="${download.id}">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="6" y="4" width="4" height="16"/>
                                <rect x="14" y="4" width="4" height="16"/>
                            </svg>
                        </button>
                        <button class="action-btn resume-btn" title="Resume" data-id="${download.id}" style="display: none;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polygon points="5,3 19,12 5,21"/>
                            </svg>
                        </button>
                        <button class="action-btn cancel-btn" title="Cancel" data-id="${download.id}">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                    </div>
                `;
                
                // Add event listeners
                const pauseBtn = item.querySelector('.pause-btn');
                const resumeBtn = item.querySelector('.resume-btn');
                const cancelBtn = item.querySelector('.cancel-btn');
                
                pauseBtn.addEventListener('click', () => {
                    pauseDownload(download.id);
                });
                
                resumeBtn.addEventListener('click', () => {
                    resumeDownload(download.id);
                });
                
                cancelBtn.addEventListener('click', () => {
                    cancelDownload(download.id);
                });
                
                downloadsList.appendChild(item);
            });
        }
        
        hideLoader();
    }

    // Pause download
    async function pauseDownload(downloadId) {
        console.log('Pausing download:', downloadId);
        
        try {
            // Update localStorage
            const downloads = JSON.parse(localStorage.getItem('downloads') || '[]');
            const download = downloads.find(d => d.id === downloadId);
            if (download) {
                download.paused = true;
                localStorage.setItem('downloads', JSON.stringify(downloads));
            }
            
            // Update UI
            const item = document.querySelector(`[data-id="${downloadId}"]`).closest('.download-item');
            const pauseBtn = item.querySelector('.pause-btn');
            const resumeBtn = item.querySelector('.resume-btn');
            pauseBtn.style.display = 'none';
            resumeBtn.style.display = 'flex';
        } catch (error) {
            console.error('Failed to pause download:', error);
        }
    }

    // Resume download
    async function resumeDownload(downloadId) {
        console.log('Resuming download:', downloadId);
        
        try {
            // Update localStorage
            const downloads = JSON.parse(localStorage.getItem('downloads') || '[]');
            const download = downloads.find(d => d.id === downloadId);
            if (download) {
                download.paused = false;
                localStorage.setItem('downloads', JSON.stringify(downloads));
            }
            
            // Update UI
            const item = document.querySelector(`[data-id="${downloadId}"]`).closest('.download-item');
            const pauseBtn = item.querySelector('.pause-btn');
            const resumeBtn = item.querySelector('.resume-btn');
            pauseBtn.style.display = 'flex';
            resumeBtn.style.display = 'none';
        } catch (error) {
            console.error('Failed to resume download:', error);
        }
    }

    // Cancel download
    async function cancelDownload(downloadId) {
        if (!confirm('Are you sure you want to cancel this download?')) return;
        
        console.log('Cancelling download:', downloadId);
        
        try {
            // Remove from localStorage
            const downloads = JSON.parse(localStorage.getItem('downloads') || '[]');
            const updatedDownloads = downloads.filter(d => d.id !== downloadId);
            localStorage.setItem('downloads', JSON.stringify(updatedDownloads));
            
            // Remove from UI
            const item = document.querySelector(`[data-id="${downloadId}"]`).closest('.download-item');
            item.style.animation = 'fadeOut 0.3s ease forwards';
            setTimeout(() => {
                item.remove();
                if (downloadsList.children.length === 0) {
                    downloadsList.style.display = 'none';
                    emptyDownloads.style.display = 'flex';
                }
            }, 300);
        } catch (error) {
            console.error('Failed to cancel download:', error);
        }
    }

    // Initialize
    loadDownloads();
    
    // Auto-refresh downloads every 2 seconds
    setInterval(loadDownloads, 2000);
});
