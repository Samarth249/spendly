(function () {
  'use strict';

  const STORAGE_KEY = 'spendly_theme';
  const THEMES = new Set(['dark', 'light', 'medium']);
  const THEME_COLORS = {
    dark: '#0a0a0f',
    light: '#f3f5fa',
    medium: '#27313b'
  };

  function readTheme() {
    try {
      const savedTheme = window.localStorage.getItem(STORAGE_KEY);
      return THEMES.has(savedTheme) ? savedTheme : 'dark';
    } catch (error) {
      return 'dark';
    }
  }

  function applyTheme(theme, persist) {
    const selectedTheme = THEMES.has(theme) ? theme : 'dark';
    const root = document.documentElement;
    root.setAttribute('data-theme', selectedTheme);
    root.style.colorScheme = selectedTheme;

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute('content', THEME_COLORS[selectedTheme]);

    if (persist) {
      try {
        window.localStorage.setItem(STORAGE_KEY, selectedTheme);
      } catch (error) {
        // The theme still applies for this page when storage is unavailable.
      }
    }

    return selectedTheme;
  }

  applyTheme(readTheme(), false);
  window.SpendlyTheme = {
    key: STORAGE_KEY,
    get: function () { return document.documentElement.getAttribute('data-theme') || 'dark'; },
    set: function (theme) { return applyTheme(theme, true); }
  };
})();
