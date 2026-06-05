// History page JavaScript
document.addEventListener('DOMContentLoaded', () => {
    // Load theme from localStorage
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    if (settings.theme === 'dark') {
        document.body.classList.add('dark');
    }

    const historyList = document.getElementById('history-list');
    const loader = document.getElementById('loader');

    // Show loader
    function showLoader() {
        loader.classList.add('active');
    }

    // Hide loader
    function hideLoader() {
        loader.classList.remove('active');
    }

    // Load history from API
    function loadHistory() {
        showLoader();
        // TODO: Replace with actual API call
        const history = []; // Will be populated from API
        
        historyList.innerHTML = '';
        
        if (history.length === 0) {
            historyList.innerHTML = '<p style="color: var(--gray-400); font-size: 14px; text-align: center; padding: 32px;">No history available</p>';
        } else {
            history.forEach(item => {
                const historyItem = document.createElement('div');
                historyItem.className = `history-item ${item.status} fade-in`;
                
                let statusIcon = '';
                if (item.status === 'success') {
                    statusIcon = `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20,6 9,17 4,12"/>
                        </svg>
                    `;
                } else if (item.status === 'error') {
                    statusIcon = `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    `;
                } else if (item.status === 'retry') {
                    statusIcon = `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23,4 23,10 17,10"/>
                            <polyline points="1,20 1,14 7,14"/>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                        </svg>
                    `;
                }
                
                historyItem.innerHTML = `
                    <div class="history-time">${item.time}</div>
                    <div class="history-content">
                        <h4>${item.title}</h4>
                        <p>${item.message}</p>
                    </div>
                    <div class="history-status ${item.status}">
                        ${statusIcon}
                    </div>
                `;
                
                historyList.appendChild(historyItem);
            });
        }
        
        hideLoader();
    }

    // Initialize
    loadHistory();
    
    // Auto-refresh history every 5 seconds
    setInterval(loadHistory, 5000);
});
