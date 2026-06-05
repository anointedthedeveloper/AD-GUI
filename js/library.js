// Library page JavaScript
document.addEventListener('DOMContentLoaded', () => {
    // Load theme from localStorage
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    if (settings.theme === 'dark') {
        document.body.classList.add('dark');
    }

    const libraryList = document.getElementById('library-list');
    const librarySearch = document.getElementById('library-search');
    const loader = document.getElementById('loader');

    // Show loader
    function showLoader() {
        loader.classList.add('active');
    }

    // Hide loader
    function hideLoader() {
        loader.classList.remove('active');
    }

    // Load downloaded anime from API
    async function loadLibrary(searchQuery = '') {
        showLoader();
        
        try {
            const library = await window.electron.ipcRenderer.invoke('scan-download-folder');
            
            libraryList.innerHTML = '';
            
            if (library.length === 0) {
                libraryList.innerHTML = '<p style="color: var(--gray-400); font-size: 14px; text-align: center; padding: 32px;">No downloaded anime found</p>';
            } else {
                const filteredLibrary = searchQuery 
                    ? library.filter(anime => anime.title.toLowerCase().includes(searchQuery.toLowerCase()))
                    : library;
                
                if (filteredLibrary.length === 0) {
                    libraryList.innerHTML = '<p style="color: var(--gray-400); font-size: 14px; text-align: center; padding: 32px;">No anime found matching your search</p>';
                } else {
                    filteredLibrary.forEach(anime => {
                        const item = document.createElement('div');
                        item.className = 'library-item fade-in';
                        
                        const thumbnailHtml = anime.thumbnail 
                            ? `<img src="${anime.thumbnail}" alt="${anime.title}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">`
                            : `<div class="poster-small">${anime.title.substring(0, 2).toUpperCase()}</div>`;
                        
                        item.innerHTML = `
                            <div class="library-header">
                                <div class="library-poster">
                                    ${thumbnailHtml}
                                </div>
                                <div class="library-info">
                                    <h3>${anime.title}</h3>
                                    <p>${anime.episodesCount} episodes downloaded</p>
                                </div>
                                <button class="expand-btn">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="6,9 12,15 18,9"/>
                                    </svg>
                                </button>
                            </div>
                            <div class="library-episodes">
                                ${anime.episodes.map(ep => `
                                    <div class="episode-item">
                                        <span>Episode ${ep.number}</span>
                                        <div class="episode-actions">
                                            <button class="play-btn" title="Play" data-path="${ep.path}">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                    <polygon points="5,3 19,12 5,21"/>
                                                </svg>
                                            </button>
                                            <button class="open-folder-btn" title="Open Folder" data-folder="${anime.path}">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                                                </svg>
                                            </button>
                                            <button class="delete-btn" title="Delete" data-path="${ep.path}">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                    <polyline points="3,6 5,6 21,6"/>
                                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        `;
                        
                        // Add event listeners
                        const expandBtn = item.querySelector('.expand-btn');
                        expandBtn.addEventListener('click', () => {
                            item.classList.toggle('expanded');
                        });
                        
                        // Play button
                        item.querySelectorAll('.play-btn').forEach(btn => {
                            btn.addEventListener('click', () => {
                                playEpisode(btn.dataset.path);
                            });
                        });
                        
                        // Open folder button
                        item.querySelectorAll('.open-folder-btn').forEach(btn => {
                            btn.addEventListener('click', () => {
                                openFolder(btn.dataset.folder);
                            });
                        });
                        
                        // Delete button
                        item.querySelectorAll('.delete-btn').forEach(btn => {
                            btn.addEventListener('click', () => {
                                deleteEpisode(btn.dataset.path);
                            });
                        });
                        
                        libraryList.appendChild(item);
                    });
                }
            }
        } catch (error) {
            console.error('Failed to load library:', error);
            libraryList.innerHTML = '<p style="color: var(--error); font-size: 14px; text-align: center; padding: 32px;">Failed to load library. Please try again.</p>';
        }
        
        hideLoader();
    }

    // Play episode
    async function playEpisode(filePath) {
        try {
            await window.electron.ipcRenderer.invoke('open-folder', filePath);
        } catch (error) {
            console.error('Failed to play episode:', error);
            alert('Failed to play episode. Please try again.');
        }
    }

    // Open folder
    async function openFolder(folderPath) {
        try {
            await window.electron.ipcRenderer.invoke('open-folder', folderPath);
        } catch (error) {
            console.error('Failed to open folder:', error);
            alert('Failed to open folder. Please try again.');
        }
    }

    // Delete episode
    async function deleteEpisode(filePath) {
        if (!confirm('Are you sure you want to delete this episode?')) return;
        
        try {
            const result = await window.electron.ipcRenderer.invoke('delete-file', filePath);
            if (result.success) {
                // Remove from UI
                const item = document.querySelector(`[data-path="${filePath}"]`).closest('.episode-item');
                item.style.animation = 'fadeOut 0.3s ease forwards';
                setTimeout(() => {
                    item.remove();
                    // Update episode count
                    const libraryItem = item.closest('.library-item');
                    const count = libraryItem.querySelectorAll('.episode-item').length;
                    libraryItem.querySelector('.library-info p').textContent = `${count} episodes downloaded`;
                    
                    // If no episodes left, remove the anime item
                    if (count === 0) {
                        libraryItem.remove();
                        if (libraryList.children.length === 0) {
                            libraryList.innerHTML = '<p style="color: var(--gray-400); font-size: 14px; text-align: center; padding: 32px;">No downloaded anime found</p>';
                        }
                    }
                }, 300);
            } else {
                alert(result.message || 'Failed to delete episode.');
            }
        } catch (error) {
            console.error('Failed to delete episode:', error);
            alert('Failed to delete episode. Please try again.');
        }
    }

    // Search functionality
    librarySearch.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        loadLibrary(query);
    });

    // Initialize
    loadLibrary();
});
