// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
import { pagePath } from '/admin/routes.mjs?v=18';
const menu = document.querySelector('.site-mode-toggle');
const host = document.querySelector('meta[name="editor-origin"]')?.content;
if (menu && host) {
  if (!('registerProperty' in CSS)) document.documentElement.classList.add('scroll-motion-fallback');
  const origin = new URL(host).origin, local = location.origin === origin;
  const { browseLabel, editLabel, editUrl, hideEditorLabel, showEditorLabel } = menu.dataset;
  const page = pagePath(location.pathname), zh = document.documentElement.lang.startsWith('zh');
  let panel, frame, sidebarToggle, articlePreview, lastArticle, articlePath, article = false, hidePanelTimer, collapsed = false, ready = false, active = false, checking = false, leaving = false, published, initialProfile, lastProfile;
  const storedMode = () => { try { return sessionStorage.getItem('site-edit-mode') === 'edit'; } catch { return false; } };
  const remember = mode => { try { sessionStorage.setItem('site-edit-mode', mode); } catch { /* The current page still changes mode. */ } };
  let flushID = 0;
  const flushes = new Map();
  function flush() {
    if (!frame || !ready) return Promise.resolve(true);
    return new Promise(resolve => {
      const id = ++flushID;
      const timer = setTimeout(() => { flushes.delete(id); resolve(false); }, 10000);
      flushes.set(id, ok => { clearTimeout(timer); resolve(ok); });
      frame.contentWindow.postMessage({ type: 'site-flush', id }, origin);
    });
  }
  async function login() {
    if (!await flush()) return;
    location.assign(`${origin}/admin/?${new URLSearchParams({ login: '1', return: page || '/en/' })}`);
  }
  function profileState() {
    const profile = document.querySelector('.profile_inner');
    if (!profile) return null;
    const img = profile.querySelector('img');
    return { title: profile.querySelector('h1')?.textContent, subtitle: profile.querySelector(':scope > span')?.textContent,
      image: img?.getAttribute('src'), imageTitle: img?.alt, contactLabel: document.querySelector('[data-profile-contact]')?.textContent, contactURL: document.querySelector('[data-profile-contact]')?.href,
      social: [...profile.querySelectorAll('.social-icons a')].map(link => ({ name: link.dataset.profileIcon, url: link.href })) };
  }
  function preview(value) {
    const profile = document.querySelector('.profile_inner');
    if (!profile || !value || typeof value.title !== 'string' || typeof value.subtitle !== 'string') return;
    profile.querySelector('h1').textContent = value.title; profile.querySelector(':scope > span').textContent = value.subtitle;
    if (typeof value.image === 'string') {
      try { const image = new URL(value.image, 'https://escapetiger.github.io');
        if (/^(https:\/\/|\/(?!\/))/.test(value.image) && (image.protocol === 'https:' || image.origin === location.origin) && !image.username && !image.password && profile.querySelector('img').src !== image.href) profile.querySelector('img').src = image.href;
      } catch { /* Keep the current image while a URL is incomplete. */ }
    }
    if (typeof value.imageTitle === 'string') profile.querySelector('img').alt = value.imageTitle;
    document.querySelectorAll('.header .brand-label, [data-profile-name]').forEach(node => { node.textContent = value.title; });
    const contact = document.querySelector('[data-profile-contact]');
    if (contact && typeof value.contactLabel === 'string') contact.textContent = value.contactLabel;
    try { const url = new URL(value.contactURL, location.origin); if (contact && (['https:', 'mailto:'].includes(url.protocol) || url.origin === location.origin)) contact.href = url.href; } catch { /* Keep valid contact links. */ }
    const icons = document.querySelector('#profile-icons');
    if (icons && Array.isArray(value.social)) {
      profile.querySelector('.social-icons').replaceChildren(...value.social.slice(0, 12).flatMap(item => {
        if (!['email', 'github', 'googlescholar'].includes(item.name)) return [];
        try {
          const url = new URL(item.url, location.origin);
          if (!['https:', 'mailto:'].includes(url.protocol) && url.origin !== location.origin) return [];
          const icon = icons.content.querySelector(`[data-icon="${item.name}"] svg`);
          const link = document.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer me'; link.title = item.name;
          link.dataset.profileIcon = item.name; link.append(icon.cloneNode(true)); return [link];
        } catch { return []; }
      }));
    }
  }
  function appearance() {
    frame?.contentWindow?.postMessage({ type: 'site-appearance', theme: document.documentElement.dataset.theme, compact: innerWidth <= 800 }, origin);
    if (articlePreview?.contentDocument?.documentElement) articlePreview.contentDocument.documentElement.dataset.theme = document.documentElement.dataset.theme;
  }
  function layout() {
    const root = document.documentElement, viewport = window.visualViewport;
    root.style.setProperty('--site-viewport-top', `${Math.max(0, viewport?.offsetTop || 0)}px`);
    root.style.setProperty('--site-editor-bottom', `${Math.max(0, innerHeight - ((viewport?.height || innerHeight) + (viewport?.offsetTop || 0)))}px`);
    const header = document.querySelector('.header');
    if (header) root.style.setProperty('--site-editor-top', `${Math.max(0, Math.ceil(header.getBoundingClientRect().bottom))}px`);
    appearance();
  }
  function showPanel(show) {
    if (!panel) return;
    clearTimeout(hidePanelTimer);
    panel.inert = !show; panel.setAttribute('aria-hidden', String(!show));
    if (show) {
      const wasHidden = panel.hidden; panel.hidden = false;
      if (wasHidden) {
        panel.dataset.open = 'false';
        // Establish the rolled state before starting the CSS reveal.
        void panel.offsetWidth;
      }
      panel.dataset.open = 'true';
    } else {
      panel.dataset.open = 'false';
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) panel.hidden = true;
      else {
        const duration = Math.max(...getComputedStyle(panel).transitionDuration.split(',').map(value => parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000)));
        hidePanelTimer = setTimeout(() => { if (!active || collapsed) panel.hidden = true; }, duration + 40);
      }
    }
  }
  function drawMode() {
    document.body.dataset.editorActive = String(active);
    document.body.dataset.editorCollapsed = String(active && collapsed);
    document.body.dataset.editorArticle = String(article);
    menu.dataset.active = String(active);
    menu.setAttribute('aria-pressed', String(active));
    const label = active ? `${editLabel} · ${browseLabel}` : `${browseLabel} · ${editLabel}`;
    menu.setAttribute('aria-label', label); menu.title = label;
    showPanel(active && !collapsed);
    if (sidebarToggle) {
      sidebarToggle.hidden = !active; sidebarToggle.dataset.collapsed = String(collapsed);
      sidebarToggle.setAttribute('aria-expanded', String(active && !collapsed));
      const action = collapsed ? showEditorLabel : hideEditorLabel;
      sidebarToggle.setAttribute('aria-label', action); sidebarToggle.title = action;
    }
    if (active) { if (lastProfile) preview(lastProfile); appearance(); }
    else if (initialProfile) preview(initialProfile);
    layout();
  }
  function renderArticlePreview() {
    const doc = articlePreview?.contentDocument;
    if (!lastArticle || !doc?.getElementById('content')) return;
    // Only the authenticated editor frame may supply sanitized preview markup.
    // It stays in a script-free sandbox, never in the public page's DOM.
    const scrollTop = articlePreview.contentWindow.scrollY;
    doc.getElementById('content').innerHTML = lastArticle.html;
    doc.getElementById('title').textContent = lastArticle.title;
    doc.getElementById('metadata').textContent = lastArticle.details;
    doc.documentElement.lang = lastArticle.locale;
    doc.documentElement.dataset.theme = document.documentElement.dataset.theme;
    articlePreview.contentWindow.scrollTo(0, scrollTop);
    document.body.dataset.editorPreviewReady = 'true';
    articlePreview.setAttribute('aria-busy', 'false');
    doc.onclick = event => { if (event.target.closest('a')) event.preventDefault(); };
  }
  async function enable() {
    if (!page || checking) return;
    if (!local) { location.assign(editUrl); return; }
    if (active) return;
    checking = true; menu.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('/admin/auth/session', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (response.status === 401) { login(); return; }
      if (!response.ok) throw new Error(zh ? '暂时无法连接，请重试。' : 'Unable to connect. Please retry.');
      if (!panel) {
        initialProfile = profileState();
        panel = document.createElement('section'); panel.id = 'site-editor-panel'; panel.className = 'scroll-sheet'; panel.hidden = true; panel.dataset.open = 'false'; panel.setAttribute('aria-label', editLabel);
        frame = document.createElement('iframe'); frame.id = 'site-editor-frame'; frame.title = `${editLabel} · ${document.title}`;
        const query = new URLSearchParams({ embedded: '1', page, lang: document.documentElement.lang, target: document.querySelector('meta[name="editor-target"]')?.content || 'home' });
        const source = document.querySelector('meta[name="editor-source"]')?.content; if (source) query.set('source', source);
        frame.src = `/admin/?${query}`; panel.append(frame);
        sidebarToggle = document.createElement('button'); sidebarToggle.id = 'site-editor-toggle'; sidebarToggle.className = 'pm-toc-btn'; sidebarToggle.type = 'button';
        sidebarToggle.setAttribute('aria-controls', panel.id);
        const icon = document.createElement('span'), close = document.createElement('span');
        icon.className = 'pm-toc-icon'; icon.setAttribute('aria-hidden', 'true');
        close.className = 'site-editor-close'; close.setAttribute('aria-hidden', 'true'); close.textContent = '×';
        sidebarToggle.append(icon, close);
        sidebarToggle.addEventListener('click', () => { collapsed = !collapsed; drawMode(); });
        document.body.append(panel, sidebarToggle);
        frame.addEventListener('load', appearance);
      }
      active = true; collapsed = false; remember('edit'); history.replaceState(null, '', `${page}?mode=edit${location.hash}`); drawMode();
    } catch (error) { alert(error.message); }
    finally { checking = false; menu.removeAttribute('aria-busy'); }
  }
  function disable() {
    if (checking) return;
    if (!local) return;
    active = false; remember('browse'); drawMode();
    void refreshPublished();
    history.replaceState(null, '', `${page}?mode=browse${location.hash}`);
  }
  async function refreshPublished() {
    if (await flush() && published && !active && !leaving) location.replace(`${published.url || page}?published=${published.commit}`);
  }
  menu.addEventListener('click', () => { if (active) disable(); else void enable(); });
  window.addEventListener('message', event => {
    if (event.origin !== origin || event.source !== frame?.contentWindow) return;
    const message = event.data;
    if (message?.type === 'editor-workspace') {
      if (message.article === true && articlePath !== message.path) {
        articlePath = message.path; lastArticle = null;
        document.body.dataset.editorPreviewReady = 'false';
        const doc = articlePreview?.contentDocument;
        doc?.getElementById('content')?.replaceChildren();
        for (const id of ['title', 'metadata']) if (doc?.getElementById(id)) doc.getElementById(id).textContent = '';
      }
      article = message.article === true; document.body.dataset.editorArticle = String(article);
      if (article && !articlePreview) {
        articlePreview = document.createElement('iframe'); articlePreview.id = 'site-article-preview';
        articlePreview.title = zh ? '文章实时预览' : 'Live article preview'; articlePreview.setAttribute('sandbox', 'allow-same-origin');
        articlePreview.setAttribute('aria-busy', 'true');
        articlePreview.src = '/admin/preview.html?v=24';
        articlePreview.addEventListener('load', renderArticlePreview);
        document.querySelector('.main').append(articlePreview);
      }
    }
    if (message?.type === 'editor-article-preview' && typeof message.html === 'string' && message.html.length <= 5000000 &&
        typeof message.title === 'string' && typeof message.details === 'string' && ['en', 'zh'].includes(message.locale)) {
      lastArticle = message; renderArticlePreview();
    }
    if (message?.type === 'editor-ready') { ready = true; appearance(); }
    if (message?.type === 'editor-flushed' && flushes.has(message.id)) { const done = flushes.get(message.id); flushes.delete(message.id); done(message.ok === true); }
    if (message?.type === 'editor-preview') { lastProfile = message.value; if (active) preview(lastProfile); }
    if (message?.type === 'editor-close') disable();
    if (message?.type === 'editor-login' && active) void login();
    if (message?.type === 'editor-published' && /^[a-f0-9]{40}$/.test(message.commit || '')) {
      published = { commit: message.commit.slice(0, 7), url: message.page === page && document.querySelector('meta[name="editor-target"]')?.content === 'blog' ? pagePath(message.url) : null };
      if (!active) void refreshPublished();
    }
  });
  document.addEventListener('click', async event => {
    if (!local || !frame || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest('a');
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download') || anchor.getAttribute('href')?.startsWith('#')) return;
    const target = new URL(anchor.href);
    if (![location.origin, 'https://escapetiger.github.io'].includes(target.origin)) return;
    event.preventDefault(); leaving = true;
    if (!await flush()) { leaving = false; alert(zh ? '修改尚未保存，请稍后重试或先导出。' : 'Edits are not saved yet. Retry or export first.'); return; }
    if (pagePath(target.pathname)) target.host = location.host;
    location.assign(target.href);
  });
  new MutationObserver(appearance).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  new ResizeObserver(layout).observe(document.querySelector('.header'));
  window.addEventListener('resize', layout);
  window.visualViewport?.addEventListener('resize', layout);
  window.visualViewport?.addEventListener('scroll', layout);
  if (local && (new URL(location.href).searchParams.get('mode') === 'edit' || new URL(location.href).searchParams.get('mode') !== 'browse' && storedMode())) void enable();
}
