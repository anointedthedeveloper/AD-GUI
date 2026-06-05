"""
browser.py - Browser automation for Cloudflare bypass using Selenium.
Launches Chrome/Edge in headless or visible mode to bypass Cloudflare protection.
"""

import time
import json
from typing import Optional, Dict, Any

# Try to import Selenium
try:
    from selenium import webdriver
    from selenium.webdriver.chrome.service import Service
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from webdriver_manager.chrome import ChromeDriverManager
    from webdriver_manager.microsoft import EdgeChromiumDriverManager
    HAS_SELENIUM = True
except ImportError:
    HAS_SELENIUM = False


class BrowserAutomation:
    """Browser automation class for Cloudflare bypass."""
    
    def __init__(self, browser_type: str = "chrome", headless: bool = True, incognito: bool = False):
        """
        Initialize browser automation.
        
        Args:
            browser_type: 'chrome' or 'edge'
            headless: Run browser in headless mode (no visible window)
            incognito: Run browser in incognito/private mode
        """
        self.browser_type = browser_type
        self.headless = headless
        self.incognito = incognito
        self.driver = None
        
    def start(self):
        """Start the browser."""
        if not HAS_SELENIUM:
            raise RuntimeError("Selenium not installed. Install with: pip install selenium webdriver-manager")
        
        if self.browser_type == "chrome":
            self._start_chrome()
        elif self.browser_type == "edge":
            self._start_edge()
        else:
            raise ValueError(f"Unsupported browser type: {self.browser_type}")
    
    def _start_chrome(self):
        """Start Chrome browser."""
        options = Options()
        
        if self.headless:
            options.add_argument("--headless=new")
        
        if self.incognito:
            options.add_argument("--incognito")
        
        # Essential options for Cloudflare bypass
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_experimental_option("excludeSwitches", ["enable-automation"])
        options.add_experimental_option('useAutomationExtension', False)
        
        # Set user agent
        options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
        
        # Use webdriver-manager to auto-download correct driver
        service = Service(ChromeDriverManager().install())
        self.driver = webdriver.Chrome(service=service, options=options)
        
        # Execute script to hide webdriver properties
        self.driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
            "source": """
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                })
            """
        })
    
    def _start_edge(self):
        """Start Edge browser."""
        options = Options()
        
        if self.headless:
            options.add_argument("--headless=new")
        
        if self.incognito:
            options.add_argument("--inprivate")
        
        # Essential options for Cloudflare bypass
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_experimental_option("excludeSwitches", ["enable-automation"])
        options.add_experimental_option('useAutomationExtension', False)
        
        # Set user agent
        options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0")
        
        # Use webdriver-manager to auto-download correct driver
        service = Service(EdgeChromiumDriverManager().install())
        self.driver = webdriver.Edge(service=service, options=options)
        
        # Execute script to hide webdriver properties
        self.driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
            "source": """
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                })
            """
        })
    
    def get(self, url: str, wait_for_cloudflare: bool = True, timeout: int = 30) -> str:
        """
        Navigate to URL and return page source.
        
        Args:
            url: URL to navigate to
            wait_for_cloudflare: Wait for Cloudflare challenge to complete
            timeout: Maximum time to wait for page load
            
        Returns:
            Page HTML source
        """
        if not self.driver:
            self.start()
        
        self.driver.get(url)
        
        if wait_for_cloudflare:
            self._wait_for_cloudflare(timeout)
        
        return self.driver.page_source
    
    def _wait_for_cloudflare(self, timeout: int = 30):
        """Wait for Cloudflare challenge to complete."""
        try:
            # Wait for either normal page or Cloudflare challenge to complete
            WebDriverWait(self.driver, timeout).until(
                lambda d: not self._is_cloudflare_challenge(d)
            )
            # Additional wait to ensure page is fully loaded
            time.sleep(2)
        except Exception:
            # Timeout or error - proceed anyway
            pass
    
    def _is_cloudflare_challenge(self, driver) -> bool:
        """Check if current page is showing Cloudflare challenge."""
        try:
            # Check for common Cloudflare indicators
            page_source = driver.page_source.lower()
            cloudflare_indicators = [
                "cloudflare",
                "checking your browser",
                "please wait while we verify",
                "challenge platform"
            ]
            return any(indicator in page_source for indicator in cloudflare_indicators)
        except Exception:
            return False
    
    def get_cookies(self) -> Dict[str, str]:
        """Get all cookies from the browser."""
        if not self.driver:
            return {}
        return {cookie['name']: cookie['value'] for cookie in self.driver.get_cookies()}
    
    def execute_script(self, script: str) -> Any:
        """Execute JavaScript in the browser."""
        if not self.driver:
            raise RuntimeError("Browser not started")
        return self.driver.execute_script(script)
    
    def close(self):
        """Close the browser."""
        if self.driver:
            self.driver.quit()
            self.driver = None
    
    def __enter__(self):
        """Context manager entry."""
        self.start()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.close()


def fetch_with_browser(url: str, browser_type: str = "chrome", headless: bool = True, 
                       incognito: bool = False, wait_for_cloudflare: bool = True) -> str:
    """
    Fetch URL using browser automation.
    
    Args:
        url: URL to fetch
        browser_type: 'chrome' or 'edge'
        headless: Run browser in headless mode
        incognito: Run browser in incognito/private mode
        wait_for_cloudflare: Wait for Cloudflare challenge to complete
        
    Returns:
        Page HTML source
    """
    with BrowserAutomation(browser_type, headless, incognito) as browser:
        return browser.get(url, wait_for_cloudflare)


if __name__ == "__main__":
    # Test the browser automation
    if HAS_SELENIUM:
        print("Testing browser automation...")
        html = fetch_with_browser("https://animepahe.si", headless=False)
        print(f"Fetched {len(html)} characters")
    else:
        print("Selenium not installed")
