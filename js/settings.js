// Settings page JavaScript
document.addEventListener('DOMContentLoaded', () => {
    const downloadFolderInput = document.getElementById('download-folder');
    const browseFolderBtn = document.getElementById('browse-folder');
    const concurrentDownloadsInput = document.getElementById('concurrent-downloads');
    const notificationsCheckbox = document.getElementById('notifications');
    const saveSettingsBtn = document.getElementById('save-settings');
    const loader = document.getElementById('loader');

    // Show loader
    function showLoader() {
        loader.classList.add('active');
    }

    // Hide loader
    function hideLoader() {
        loader.classList.remove('active');
    }

    // Load settings from localStorage or API
    async function loadSettings() {
        showLoader();
        
        try {
            // Get default download folder from Electron
            const defaultFolder = await window.electron.ipcRenderer.invoke('get-default-download-folder');
            
            const settings = JSON.parse(localStorage.getItem('settings') || '{}');
            
            downloadFolderInput.value = settings.downloadFolder || defaultFolder;
            concurrentDownloadsInput.value = settings.concurrentDownloads || 3;
            notificationsCheckbox.checked = settings.notifications !== false;
            
            // Set quality
            const quality = settings.quality || '720p';
            const qualityRadio = document.querySelector(`input[name="quality"][value="${quality}"]`);
            if (qualityRadio) {
                qualityRadio.checked = true;
            }
            
            // Set theme
            const theme = settings.theme || 'light';
            const themeRadio = document.querySelector(`input[name="theme"][value="${theme}"]`);
            if (themeRadio) {
                themeRadio.checked = true;
            }
            
            // Apply theme
            if (theme === 'dark') {
                document.body.classList.add('dark');
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
            // Fallback to localStorage only
            const settings = JSON.parse(localStorage.getItem('settings') || '{}');
            downloadFolderInput.value = settings.downloadFolder || '';
            concurrentDownloadsInput.value = settings.concurrentDownloads || 3;
            notificationsCheckbox.checked = settings.notifications !== false;
        }
        
        hideLoader();
    }

    // Save settings
    async function saveSettings() {
        showLoader();
        
        const qualityInput = document.querySelector('input[name="quality"]:checked');
        const themeInput = document.querySelector('input[name="theme"]:checked');
        
        const settings = {
            downloadFolder: downloadFolderInput.value,
            quality: qualityInput ? qualityInput.value : '720p',
            concurrentDownloads: parseInt(concurrentDownloadsInput.value),
            theme: themeInput ? themeInput.value : 'light',
            notifications: notificationsCheckbox.checked
        };
        
        // Save to localStorage
        localStorage.setItem('settings', JSON.stringify(settings));
        
        // Apply theme immediately
        if (settings.theme === 'dark') {
            document.body.classList.add('dark');
        } else {
            document.body.classList.remove('dark');
        }
        
        // TODO: Replace with actual API call
        console.log('Saving settings:', settings);
        
        setTimeout(() => {
            hideLoader();
            alert('Settings saved successfully!');
        }, 500);
    }

    // Browse folder
    async function browseFolder() {
        try {
            const folderPath = await window.electron.ipcRenderer.invoke('select-download-folder');
            if (folderPath) {
                downloadFolderInput.value = folderPath;
            }
        } catch (error) {
            console.error('Failed to select folder:', error);
            alert('Failed to select folder. Please try again.');
        }
    }

    // Event listeners
    saveSettingsBtn.addEventListener('click', saveSettings);
    browseFolderBtn.addEventListener('click', browseFolder);
    
    // Theme change listener
    document.querySelectorAll('input[name="theme"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'dark') {
                document.body.classList.add('dark');
            } else {
                document.body.classList.remove('dark');
            }
        });
    });

    // Initialize
    loadSettings();
});
