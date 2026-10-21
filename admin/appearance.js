// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
(() => {
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference;
  try { preference = localStorage.getItem('pref-theme'); } catch { /* Keep a page-local choice if storage is blocked. */ }
  const apply = () => {
    document.documentElement.dataset.theme = ['light', 'dark'].includes(preference) ? preference : system.matches ? 'dark' : 'light';
    window.dispatchEvent(new Event('editor-theme-change'));
  };
  apply(); system.addEventListener('change', apply);
  // Show usable controls before the optional font stylesheet finishes downloading.
  window.addEventListener('DOMContentLoaded', () => requestAnimationFrame(() => requestAnimationFrame(() => {
    const fonts = document.getElementById('editor-fonts'); if (fonts) fonts.media = 'all';
  })), { once: true });
  window.addEventListener('storage', event => { if (event.key === 'pref-theme') { preference = event.newValue; apply(); } });
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-theme-toggle]')) return;
    preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('pref-theme', preference); } catch { /* The current page still updates. */ }
    apply();
  });
})();
