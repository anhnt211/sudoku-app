/**
 * @file PWA registration + iOS standalone helpers.
 */

const THEME_COLORS = { light: '#ffffff', dark: '#0b1220' };

/**
 * Register service worker. Returns a function that updates the address-bar
 * theme color to match the active theme ('light' | 'dark').
 */
export function setupPWA() {
  if ('serviceWorker' in navigator) {
    // When a new SW takes control (after SKIP_WAITING), reload once so the page
    // runs the freshly-cached JS instead of the stale modules already in memory.
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./service-worker.js', { scope: './' })
        .then((reg) => {
          reg.addEventListener('updatefound', () => {
            const sw = reg.installing;
            if (!sw) return;
            sw.addEventListener('statechange', () => {
              if (sw.state === 'installed' && navigator.serviceWorker.controller) {
                sw.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });
        })
        .catch((err) => console.warn('SW register failed', err));
    });
  }

  return {
    setTheme(theme) {
      const color = THEME_COLORS[theme] || THEME_COLORS.light;
      let tags = document.querySelectorAll('meta[name="theme-color"]');
      if (!tags.length) {
        const tag = document.createElement('meta');
        tag.name = 'theme-color';
        document.head.appendChild(tag);
        tags = [tag];
      }
      tags.forEach((t) => {
        t.removeAttribute('media');
        t.setAttribute('content', color);
      });
      // Match iOS status bar (only takes effect on next launch).
      const ios = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
      if (ios) ios.setAttribute('content', theme === 'dark' ? 'black-translucent' : 'default');
    },
  };
}
