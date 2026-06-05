// Results page JavaScript
document.addEventListener('DOMContentLoaded', () => {
    // Load theme from localStorage
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    if (settings.theme === 'dark') {
        document.body.classList.add('dark');
    }

    const backToHomeBtn = document.getElementById('back-to-home');
    const searchQuery = document.getElementById('search-query');
    const resultsGrid = document.getElementById('results-grid');
    const loader = document.getElementById('loader');

    // Show loader
    function showLoader() {
        loader.classList.add('active');
    }

    // Hide loader
    function hideLoader() {
        loader.classList.remove('active');
    }

    // Get search query from URL
    function getSearchQuery() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('q');
    }

    // Load search results from API
    async function loadSearchResults() {
        showLoader();
        const query = getSearchQuery();
        
        if (!query) {
            searchQuery.textContent = 'No search query provided';
            resultsGrid.innerHTML = '<p style="color: var(--gray-400); font-size: 14px; text-align: center; padding: 32px;">No search results</p>';
            hideLoader();
            return;
        }
        
        searchQuery.textContent = `Showing results for: ${query}`;
        
        try {
            // TODO: Replace with actual API call
            // const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            // const results = await response.json();
            
            // Simulate API response
            const results = []; // Will be populated from API
            
            resultsGrid.innerHTML = '';
            
            if (results.length === 0) {
                resultsGrid.innerHTML = '<p style="color: var(--gray-400); font-size: 14px; text-align: center; padding: 32px;">No results found</p>';
            } else {
                results.forEach(anime => {
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
                        window.location.href = `details.html?id=${anime.id}`;
                    });
                    resultsGrid.appendChild(card);
                });
            }
        } catch (error) {
            console.error('Failed to load search results:', error);
            resultsGrid.innerHTML = '<p style="color: var(--error); font-size: 14px; text-align: center; padding: 32px;">Failed to load results. Please try again.</p>';
        }
        
        hideLoader();
    }

    // Event listeners
    backToHomeBtn.addEventListener('click', () => {
        window.location.href = 'index.html';
    });

    // Initialize
    loadSearchResults();
});
