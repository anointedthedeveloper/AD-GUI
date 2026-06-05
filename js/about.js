// About page JavaScript
document.addEventListener('DOMContentLoaded', () => {
    // Load theme from localStorage
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    if (settings.theme === 'dark') {
        document.body.classList.add('dark');
    }

    const appVersion = document.getElementById('app-version');
    const loader = document.getElementById('loader');

    // Show loader
    function showLoader() {
        loader.classList.add('active');
    }

    // Hide loader
    function hideLoader() {
        loader.classList.remove('active');
    }

    // Load app version
    async function loadAppVersion() {
        showLoader();
        try {
            // const version = await window.electron.ipcRenderer.invoke('get-app-version');
            // appVersion.textContent = `Version ${version}`;
            appVersion.textContent = 'Version 1.0.0';
        } catch (error) {
            console.error('Failed to get app version:', error);
            appVersion.textContent = 'Version 1.0.0';
        }
        hideLoader();
    }

    // Initialize
    loadAppVersion();
});
