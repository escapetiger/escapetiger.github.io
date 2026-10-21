// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
import { GitHub, newPost, postPath, readPost, updatePost, articleState, articleURL } from './core.mjs?v=11';
import { deploymentStatus, viewportGeometry } from './deployment.mjs?v=7';
import { messages } from './messages.mjs?v=13';
import { BackupStore } from './backups.mjs?v=11';
import { drawBackups } from './backup-ui.mjs?v=11';
import { prepareImage, encodedImage, insertMarkup, MAX_IMAGES, MAX_TOTAL_BYTES } from './media.mjs?v=9';
import { renderPreview } from './preview.mjs?v=6';
import { RepositoryCache } from './read-cache.mjs?v=9';
import { loadPreview } from './preview-loader.mjs?v=9';
import { authConfiguration, authRequest, SessionGitHub, siteOrigin } from './auth.mjs?v=11';
import { preferredLocale, localeKey, articleLanguage, taxonomyTerms, articleDate, articleSummary, selectArticles } from './library.mjs?v=11';
import { Credentials } from './credentials.mjs?v=4';

import { DataEditor, dataPath } from './data-editor.mjs?v=13';

const credentials = new Credentials();
const $ = id => document.getElementById(id);
const pendingKey = 'yicai-blog-publication-v1', backups = new BackupStore();
const sourceRepo = 'https://github.com/escapetiger/hugo-yicai';
let locale = preferredLocale(navigator.language);
let authMode = 'token', accountLogin = '';
let api, files = [], cache = new Map(), libraryEpoch = 0, hydrationEpoch = 0, listing = false, view = 'login', tab = 'body';
let documentText = '', originalPath = null, originalSha = null, savedState = 'draft', dirty = false, busy = false;
let pending = null, progressState = { stage: 'queued' }, pollTimer, checking = false, pollEpoch = 0;
let backupSession = null, assets = [], backupTimer, backupQueue = Promise.resolve(), backupsReturn = 'library';
let imageSelection = { start: 0, end: 0 }, objectURLs = new Map(), libraryFrame = 0;
const t = key => messages[locale][key];
let section = 'home';
const dataEditor = new DataEditor({ root: $('data-content'), locale: () => locale, api: () => api, notify: notice,
  published(result) {
    clearTimeout(pollTimer); ++pollEpoch;
    const file = result.files.find(file => file.path === dataPath(result.kind, locale));
    pending = { ...file, files: result.files, kind: result.kind, commit: result.commit, action: 'publish',
      title: result.kind === 'cv' ? 'CV' : 'Publications', url: `/${locale}/${result.kind}/`, started: Date.now() };
    savePending(); progressState = { stage: 'queued' }; renderProgress(); setView('result'); void checkProgress();
  }
});
function renderHome() {
  $('home-resume').hidden = !documentText || articleLanguage($('path').value) !== locale;
  $('home-progress').hidden = !pending;
  $('published-site').href = `${siteOrigin}/${locale}/`;
  document.querySelectorAll('[data-local-edits]').forEach(node => {
    const kind = node.dataset.localEdits;
    const edited = kind === 'blog' ? dirty && articleLanguage($('path').value) === locale
      : dataEditor.kind === kind ? dataEditor.dirty : dataEditor.sessions.get(kind)?.dirty;
    node.hidden = !edited;
  });
}
async function openHome(push = true) {
  if (!api) { setView('login', push); return; }
  await run(async () => {
    if (!await mayReplace() || (dataEditor.dirty && !dataEditor.backup())) return;
    setView('home', push);
  });
}
function renderNavigation() {
  $('editor-home').setAttribute('aria-label', t('homeHeading'));
  if (section === 'home') $('editor-home').setAttribute('aria-current', 'page');
  else $('editor-home').removeAttribute('aria-current');
  document.querySelector('.section-menu').setAttribute('aria-label', locale === 'zh' ? '编辑栏目' : 'Edit section');
  document.querySelectorAll('[data-section]').forEach(button => {
    button.textContent = t({ cv: 'navCV', publications: 'navPublications', blog: 'navBlog' }[button.dataset.section]);
    const active = button.dataset.section === section;
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
}
async function openSection(next, push = true) {
  if (!api) { setView('login'); return; }
  await run(async () => {
    if (!await mayReplace()) return;
    if (dataEditor.dirty && !dataEditor.backup()) return;
    if (next !== 'blog') {
      ++hydrationEpoch; notice(`${t('loading')} ${t(next === 'cv' ? 'navCV' : 'navPublications')}`);
      await dataEditor.open(next);
    }
    section = next; renderNavigation(); setView(next === 'blog' ? 'library' : 'data', push);
  });
}

const tagsText = value => (Array.isArray(value) ? value : typeof value === 'string' ? [value] : []).join(', ');
const splitTags = value => value.split(/[,，\n]/).map(item => item.trim()).filter(Boolean);
function notice(message = '', error = false) {
  document.querySelectorAll('[data-notice]').forEach(node => {
    node.textContent = message; node.hidden = !message; node.classList.toggle('error', error);
  });
}
function setView(next, push = true) {
  if (!api && next !== 'login') next = 'login';
  if (next === 'editor' && !documentText) next = 'library';
  if (next === 'result' && !pending) next = 'library';
  view = next;
  if (next !== 'library') ++hydrationEpoch;
  if (['library', 'editor', 'new', 'backups'].includes(next)) section = 'blog';
  if (next === 'result') section = pending?.kind || 'blog';
  if (['home', 'login'].includes(next)) section = next;
  renderHome();
  renderNavigation();
  document.body.dataset.view = next;
  if (next === 'editor') window.scrollTo(0, 0);
  document.querySelectorAll('.view').forEach(node => { node.hidden = node.id !== `${next}-view`; });
  $('resume').hidden = !documentText || articleLanguage($('path').value) !== locale;
  $('progress').hidden = !pending;
  $('more-menu').open = false;
  notice();
  const state = { editorView: next, section };
  if (push) history.pushState(state, '', `#${next}`);
  else history.replaceState(state, '', `#${next}`);
  if (next !== 'editor') window.scrollTo(0, 0);
  updateViewport();
  if (next === 'library' && api) void hydrate(api);
}
async function run(task) {
  if (busy) return;
  busy = true;
  setBusy(true);
  notice();
  try { await task(); } catch (error) { notice(`${t('error')}${error.message}`, true); }
  finally { busy = false; setBusy(false); }
}
function setBusy(value) {
  $('editor-home').setAttribute('aria-disabled', String(value));
  // Keep export available even when a network request is pending.
  document.querySelectorAll('button, input, select, textarea').forEach(node => {
    if (!['export', 'data-export', 'locale', 'theme-toggle'].includes(node.id)) node.disabled = value;
  });
  document.querySelectorAll('.view').forEach(node => node.setAttribute('aria-busy', String(value && !node.hidden)));
}
async function mayReplace() { return !dirty || await flushBackup(true) || confirm(t('discard')); }
function activeAssets() { return assets.filter(asset => documentText.includes(asset.url)); }
function queueBackup(checkpoint = false) {
  if (!documentText || !backupSession || (backupSession.suppressed && !backupSession.touched) || (!dirty && !backupSession.touched)) return Promise.resolve();
  const session = backupSession, images = activeAssets();
  const record = { id: session.id, path: $('path').value, text: documentText, originalPath, originalSha, savedState, dirty,
    assets: images.map(({ path, url, name, uploaded }) => ({ path, url, name, uploaded })) };
  const task = backupQueue.catch(() => {}).then(async () => {
    const saved = await backups.save(record, session.revision, images.filter(asset => !asset.persisted), checkpoint);
    session.revision = saved.revision;
    images.forEach(asset => { asset.persisted = true; });
    if (session === backupSession) $('backup-status').textContent = t('backup');
  });
  backupQueue = task;
  task.catch(error => { if (session === backupSession) $('backup-status').textContent = t(error.code === 'BACKUP_CONFLICT' ? 'backupConflict' : 'backupFailed'); });
  return task;
}
function backup() {
  clearTimeout(backupTimer); $('backup-status').textContent = t('backupSaving');
  backupTimer = setTimeout(() => { void queueBackup().catch(() => {}); }, 250);
}
async function flushBackup(checkpoint = false) {
  clearTimeout(backupTimer);
  try { await queueBackup(checkpoint); return true; } catch { return false; }
}
function changed() { dirty = true; if (backupSession) { backupSession.touched = true; backupSession.suppressed = false; } backup(); }
function renderLocale() {
  if (api instanceof SessionGitHub) api.expiredMessage = t('sessionExpired');
  document.documentElement.lang = locale; $('locale').textContent = locale === 'zh' ? 'En' : 'Zh';
  $('locale').setAttribute('aria-label', locale === 'zh' ? 'Switch to English' : '切换为中文');
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
  $('search').placeholder = t('search');
  renderLibraryFilters(); renderCards(); renderEditorHeading(); renderProgress();
  $('theme-toggle').setAttribute('aria-label', t('toggleTheme'));
  $('theme-toggle').title = t('toggleTheme');
  $('resume').hidden = !documentText || articleLanguage($('path').value) !== locale;
  $('preview-frame').title = t('preview');
  renderConnection(); renderHome();
  if (tab === 'preview') updatePreview();
  if (view === 'backups') void showBackups();
  if (view === 'data') dataEditor.render();
  renderNavigation();
  if (busy) setBusy(true);
}
function renderLibraryFilters() {
  const posts = files.filter(file => articleLanguage(file.path) === locale).map(file => cache.get(file.sha)?.post?.metadata || {});
  for (const [id, key, values] of [
    ['filter-category', 'allCategories', posts.flatMap(meta => taxonomyTerms(meta.categories))],
    ['filter-tag', 'allTags', posts.flatMap(meta => taxonomyTerms(meta.tags))],
    ['filter-year', 'allYears', posts.map(meta => articleDate(meta)?.year).filter(Boolean)]
  ]) {
    const select = $(id), previous = select.value;
    const options = [...new Set(values)].sort((a, b) => id === 'filter-year' ? b.localeCompare(a) : a.localeCompare(b, locale));
    select.replaceChildren(new Option(t(key), ''), ...options.map(value => new Option(value, value)));
    select.value = options.includes(previous) ? previous : '';
  }
}
function renderCards() {
  const filtered = selectArticles(files, cache, { language: locale, term: $('search').value, state: $('filter-state').value,
    category: $('filter-category').value, tag: $('filter-tag').value, year: $('filter-year').value });
  const cards = filtered.map(file => {
    const entry = cache.get(file.sha), metadata = entry?.post?.metadata || {};
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'article-card'; card.dataset.path = file.path; card.lang = locale;
    const state = articleState(file.path, metadata), date = articleDate(metadata, locale);
    const top = document.createElement('span'); top.className = 'card-top';
    const badge = document.createElement('span'); badge.className = 'badge'; badge.dataset.state = state; badge.textContent = t(state);
    const time = document.createElement('time'); time.className = 'card-date'; time.textContent = date?.label || t('undated');
    if (date) time.dateTime = date.iso;
    top.append(badge, time);
    const title = document.createElement('strong'); title.className = 'card-title';
    title.textContent = typeof metadata.title === 'string' ? metadata.title : file.path.split('/').at(-1).replace(/\.md$/, '');
    const summary = document.createElement('span'); summary.className = 'card-summary'; summary.textContent = articleSummary(entry?.post); summary.hidden = !summary.textContent;
    const taxonomies = document.createElement('span'); taxonomies.className = 'card-taxonomies';
    for (const [key, values] of [['categories', taxonomyTerms(metadata.categories)], ['tags', taxonomyTerms(metadata.tags)]]) {
      const row = document.createElement('span'); row.className = `card-${key}`;
      const label = document.createElement('span'); label.className = 'taxonomy-label'; label.textContent = t(key); row.append(label);
      for (const value of values.length ? values : [t(key === 'categories' ? 'uncategorized' : 'noTags')]) {
        const chip = document.createElement('span'); chip.className = 'taxonomy-chip'; chip.textContent = value; row.append(chip);
      }
      taxonomies.append(row);
    }
    const footer = document.createElement('span'); footer.className = 'card-footer';
    const detail = document.createElement('span'); detail.className = 'card-path';
    detail.textContent = entry?.error ? t('retryArticle') : file.path.replace(`content/blog/${locale}/`, '');
    const edit = document.createElement('span'); edit.className = 'card-edit'; edit.textContent = `${t('editArticle')} →`;
    footer.append(detail, edit); card.append(top, title, summary, taxonomies, footer);
    card.addEventListener('click', () => openArticle(file)); return card;
  });
  if (!cards.length) {
    const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = t(listing ? 'loading' : 'noArticles'); cards.push(empty);
  }
  $('articles').replaceChildren(...cards);
  const missing = files.some(file => articleLanguage(file.path) === locale && !cache.has(file.sha));
  $('library-count').textContent = listing && !files.length ? t('loading') : `${filtered.length} ${t('articlesUnit')}${missing ? ` · ${t('loading')}` : ''}`;
}
async function readArticle(client, file) {
  const existing = cache.get(file.sha);
  if (existing && !existing.error) return existing;
  const text = await client.read(file.sha);
  let post;
  try { post = readPost(text); }
  catch (error) { return { text, error: error.message }; }
  return { text, post };
}
function scheduleLibraryRender() {
  if (libraryFrame) return;
  libraryFrame = requestAnimationFrame(() => { libraryFrame = 0; renderLibraryFilters(); renderCards(); });
}
async function hydrate(client) {
  const epoch = ++hydrationEpoch, language = locale;
  const unloaded = files.filter(file => articleLanguage(file.path) === language && (!cache.has(file.sha) || cache.get(file.sha).error));
  for (let i = 0; i < unloaded.length; i += 3) {
    if (client !== api || epoch !== hydrationEpoch) return;
    await Promise.all(unloaded.slice(i, i + 3).map(async file => {
      let entry;
      try { entry = await readArticle(client, file); } catch (error) { entry = { error: error.message }; }
      if (client !== api || epoch !== hydrationEpoch) return;
      cache.set(file.sha, entry); scheduleLibraryRender();
    }));
  }
}
async function refresh() {
  const client = api, epoch = ++libraryEpoch;
  listing = true; renderCards();
  try {
    const snapshot = await client.snapshot();
    if (client !== api || epoch !== libraryEpoch) return;
    files = snapshot.files.filter(file => {
      try { postPath(file.path); return file.type === 'blob' && file.mode === '100644'; }
      catch { return false; }
    }).sort((a, b) => a.path.localeCompare(b.path));
    renderLibraryFilters(); renderCards();
    if (view === 'library') void hydrate(client);
  } finally { if (client === api && epoch === libraryEpoch) { listing = false; renderCards(); } }
}
function renderEditorHeading() {
  let title;
  try { title = readPost(documentText).metadata.title; } catch { /* Raw edits may temporarily be invalid. */ }
  $('editor-title').textContent = typeof title === 'string' && title.trim() ? title : t('emptyTitle');
  $('article-state').textContent = t(savedState);
  let meta = {}; try { meta = readPost(documentText).metadata; } catch { /* Invalid raw edits stay editable. */ }
  $('editor-meta').textContent = [articleDate(meta, locale)?.label, ...taxonomyTerms(meta.categories), ...taxonomyTerms(meta.tags).map(tag => `#${tag}`)].filter(Boolean).join(' · ');
  $('save-draft').hidden = savedState !== 'draft';
  $('retract').hidden = savedState === 'draft';
  $('publish').textContent = t(savedState === 'draft' ? 'publish' : 'publishUpdate');
}
function fillFields() {
  const post = readPost(documentText), meta = post.metadata;
  $('source').value = post.body;
  $('title').value = typeof meta.title === 'string' ? meta.title : '';
  $('date').value = typeof meta.date === 'string' ? meta.date.slice(0, 10) : '';
  $('tags').value = tagsText(meta.tags); $('categories').value = tagsText(meta.categories);
  $('raw-source').value = documentText;
  renderEditorHeading();
}
function syncInformation() {
  const meta = readPost(documentText).metadata;
  const values = { title: $('title').value };
  const date = $('date').value;
  if (date !== (typeof meta.date === 'string' ? meta.date.slice(0, 10) : '')) values.date = date || undefined;
  for (const id of ['tags', 'categories']) {
    if ($(id).value !== tagsText(meta[id])) values[id] = splitTags($(id).value);
  }
  documentText = updatePost(documentText, values);
}
function selectTab(next) {
  if (tab === 'info') {
    try { syncInformation(); }
    catch (error) { notice(`${t('error')}${error.message}`, true); return false; }
  }
  if (next !== 'advanced') {
    try { fillFields(); }
    catch (error) { notice(`${t('rawInvalid')}\n${error.message}`, true); return false; }
  } else $('raw-source').value = documentText;
  tab = next;
  document.querySelectorAll('[data-tab]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.tab === next)));
  document.querySelectorAll('[data-panel]').forEach(node => { node.hidden = node.dataset.panel !== next; });
  notice();
  if (next === 'preview') updatePreview();
  return true;
}
async function showEditor(path, text, loadedPath, sha, state, context) {
  clearTimeout(backupTimer);
  if (documentText) {
    const flushed = await flushBackup(true);
    if (flushed && context?.session.id === backupSession?.id) context.session.revision = Math.max(context.session.revision, backupSession.revision);
  }
  let existing;
  if (!context) {
    try { existing = (await backups.list()).find(record => record.path === path || record.originalPath === path); }
    catch { /* Editing and export remain available when browser storage is blocked. */ }
  }
  backupSession = context?.session || { id: existing?.id || crypto.randomUUID(), revision: existing?.revision || 0 };
  resetImageURLs();
  assets = context?.assets || [];
  if (existing) {
    for (const asset of existing.assets) {
      const image = await backups.image(asset.path);
      if (image?.blob) assets.push({ ...asset, blob: image.blob, persisted: true });
    }
  }
  documentText = text; originalPath = loadedPath; originalSha = sha;
  $('path').value = path;
  try { savedState = state || articleState(loadedPath || path, readPost(text).metadata); }
  catch { savedState = state || (path.split('/')[3] === 'drafts' ? 'draft' : 'public'); }
  dirty = false;
  $('backup-status').textContent = t('localOnly');
  setView('editor');
  tab = 'body';
  if (!selectTab('body')) {
    selectTab('advanced'); notice(t('rawInvalid'), true);
  }
  renderEditorHeading();
  updateImageTray();
  if (existing?.dirty && existing.text !== text) notice(t('backupAvailable'));
}
async function openArticle(file) {
  if (file.path === originalPath && documentText && dirty) { setView('editor'); return; }
  if (!await mayReplace()) return;
  await run(async () => {
    ++hydrationEpoch;
    const entry = await readArticle(api, file);
    cache.set(file.sha, entry);
    await showEditor(file.path, entry.text, file.path, file.sha);
  });
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name.split(/[\\/]/).at(-1) || 'download';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function localImageURL(asset) {
  if (!objectURLs.has(asset.path)) objectURLs.set(asset.path, URL.createObjectURL(asset.blob));
  return objectURLs.get(asset.path);
}
function resetImageURLs() {
  $('preview-frame').contentDocument?.getElementById('content')?.replaceChildren();
  for (const url of objectURLs.values()) URL.revokeObjectURL(url);
  objectURLs.clear();
}
function updateImageTray() {
  const images = activeAssets(); $('image-tray').hidden = !images.length;
  const label = document.createElement('span');
  const count = images.filter(asset => !asset.uploaded).length;
  label.textContent = count ? `${count} ${t('imagePending')}` : t('imagesSaved');
  const thumbs = images.map(asset => {
    const button = document.createElement('button'); button.type = 'button'; button.title = `${t('downloadImage')}: ${asset.name}`;
    const image = document.createElement('img'); image.src = localImageURL(asset); image.alt = asset.name;
    button.append(image); button.addEventListener('click', () => download(asset.blob, asset.path.split('/').at(-1)));
    return button;
  });
  $('image-tray').replaceChildren(label, ...thumbs);
}
async function updatePreview() {
  try {
    const frame = $('preview-frame');
    frame.setAttribute('aria-busy', 'true'); if ($('preview-loading')) $('preview-loading').hidden = false;
    await loadPreview(frame);
    if (tab !== 'preview' || !documentText) return;
    const post = readPost(documentText), path = $('path').value.replace(/^(content\/blog\/(en|zh)\/)drafts\//, '$1');
    const base = new URL(articleURL(path, post.metadata) || '/', siteOrigin).href;
    const images = new Map(activeAssets().map(asset => [new URL(asset.url, siteOrigin).href, localImageURL(asset)]));
    renderPreview($('preview-frame'), { body: post.body, title: post.metadata.title || '', details: $('editor-meta').textContent, base, images, locale });
  } catch (error) { notice(`${t('error')}${error.message}`, true); }
  finally { $('preview-frame').setAttribute('aria-busy', 'false'); if ($('preview-loading')) $('preview-loading').hidden = true; }
}
async function showBackups() {
  if (view !== 'backups') { backupsReturn = ['editor', 'home'].includes(view) ? view : 'library'; await flushBackup(true); setView('backups'); }
  try {
    try { await backups.migrate(); } catch { notice(t('invalidBackup'), true); }
    await backups.collect();
    const records = (await backups.list()).filter(record => articleLanguage(record.path) === locale);
    drawBackups($('backups-list'), records, { t, locale,
      restore: async (record, snapshot) => {
        if (!confirm(t('restoreConfirm')) || !await mayReplace()) return;
        await run(async () => {
          const latest = await backups.get(record.id);
          if (!latest) throw new Error(t('noBackup'));
          const images = [];
          for (const asset of snapshot.assets) {
            const image = await backups.image(asset.path);
            if (image?.blob) images.push({ ...asset, blob: image.blob, persisted: true });
            else if (!asset.uploaded) throw new Error(t('invalidBackup'));
          }
          await showEditor(latest.path, snapshot.text, latest.originalPath, latest.originalSha, latest.savedState,
            { session: { id: latest.id, revision: latest.revision }, assets: images });
          dirty = true; await flushBackup(true); notice(t('restored'));
        });
      },
      remove: async record => {
        if (!confirm(t('deleteBackupConfirm'))) return;
        await run(async () => {
          await backupQueue.catch(() => {}); await backups.remove(record.id);
          if (backupSession?.id === record.id) {
            backupSession = { id: crypto.randomUUID(), revision: 0, suppressed: true }; assets.forEach(asset => { asset.persisted = false; });
          }
          await showBackups();
        });
      },
      download: record => download(new Blob([record.text], { type: 'text/markdown;charset=utf-8' }), record.path.split('/').at(-1)),
      image: async asset => {
        try { const data = await backups.image(asset.path); if (data?.blob) download(data.blob, asset.path.split('/').at(-1)); }
        catch (error) { notice(`${t('error')}${error.message}`, true); }
      }
    });
  } catch (error) { notice(`${t('backupFailed')}\n${error.message}`, true); }
}
async function chooseImages(event) {
  const files = [...event.target.files]; event.target.value = '';
  if (!files.length || busy) return;
  await run(async () => {
    notice(t('imageWorking'));
    await flushBackup(true);
    const existing = activeAssets();
    if (existing.length + files.length > MAX_IMAGES) throw new Error(t('imageSize'));
    const prepared = [];
    for (const file of files) {
      try { prepared.push(await prepareImage(file)); }
      catch (error) { throw new Error(`${file.name}: ${t(error.message) || error.message}`); }
    }
    if ([...existing, ...prepared].reduce((sum, asset) => sum + asset.blob.size, 0) > MAX_TOTAL_BYTES) throw new Error(t('imageSize'));
    const body = readPost(documentText).body;
    const start = Math.min(imageSelection.start, body.length), end = Math.min(imageSelection.end, body.length);
    const markup = prepared.map(asset => `![${asset.name.replace(/\.[^.]+$/, '').replace(/[\[\]\\\n\r]/g, '')}](${asset.url})`).join('\n\n');
    const insert = `\n\n${markup}\n\n`;
    documentText = updatePost(documentText, {}, body.slice(0, start) + insert + body.slice(end));
    assets.push(...prepared); dirty = true; backupSession.touched = true; backupSession.suppressed = false; fillFields(); updateImageTray();
    $('source').setSelectionRange(start + insert.length, start + insert.length);
    const saved = await flushBackup(true);
    if (!saved) notice(t('backupFailed'), true);
  });
}
function savePending() {
  try { localStorage.setItem(pendingKey, JSON.stringify(pending)); } catch { /* The commit remains accessible through GitHub. */ }
}
function restorePending() {
  try {
    const record = JSON.parse(localStorage.getItem(pendingKey));
    if (!record || !/^[0-9a-f]{40}$/.test(record.commit) || !/^[0-9a-f]{40}$/.test(record.sha) ||
        !['draft', 'publish'].includes(record.action) || !Number.isFinite(record.started)) return;
    if (['cv', 'publications'].includes(record.kind)) {
      if (!['en', 'zh'].some(lang => record.path === dataPath(record.kind, lang)) ||
          !Array.isArray(record.files) || record.files.length !== 2 || !['en', 'zh'].every(lang => record.files.some(file => file.path === dataPath(record.kind, lang) && /^[0-9a-f]{40}$/.test(file.sha)))) return;
    } else postPath(record.path);
    if (record.url && (typeof record.url !== 'string' || !record.url.startsWith('/') || record.url.startsWith('//'))) return;
    pending = record;
    progressState = terminalStages.has(record.stage) ? { stage: record.stage, url: record.url } : { stage: 'queued' };
  } catch { /* Ignore unavailable storage or invalid recovery data. */ }
}
function renderProgress() {
  if (!pending) return;
  const stage = progressState.stage;
  $('result-title').textContent = typeof pending.title === 'string' ? pending.title : pending.path;
  $('result-status').textContent = t(stage);
  $('result-help').hidden = !['excluded', 'failed', 'disabled', 'unverified', 'timeout'].includes(stage);
  $('result-help').textContent = $('result-help').hidden ? '' : t(`${stage}Help`);
  $('commit-link').href = `${sourceRepo}/commit/${pending.commit}`;
  const logs = progressState.logs;
  $('build-link').href = typeof logs === 'string' &&
    [sourceRepo, 'https://github.com/escapetiger/escapetiger.github.io'].some(repo => logs.startsWith(`${repo}/actions/runs/`))
    ? logs : `${sourceRepo}/actions/workflows/mobile-publish.yml`;
  $('view-article').hidden = stage !== 'live';
  if (pending.kind) $('view-article').textContent = locale === 'zh' ? '查看正式页面' : 'View published page';
  else $('view-article').textContent = t('viewArticle');
  if (stage === 'live') {
    const url = new URL(progressState.url, siteOrigin);
    url.searchParams.set('published', pending.commit.slice(0, 7));
    $('view-article').href = url.href;
  }
  const deployed = ['live', 'draftLive', 'excluded', 'superseded'].includes(stage);
  const built = deployed || stage === 'deploying';
  $('step-source').className = 'done';
  $('step-build').className = built ? 'done' : ['building', 'queued'].includes(stage) ? 'active' : '';
  $('step-live').className = deployed ? 'done' : stage === 'deploying' ? 'active' : '';
  for (const id of ['step-source', 'step-build', 'step-live']) {
    const node = $(id);
    if (node.classList.contains('active')) node.setAttribute('aria-current', 'step'); else node.removeAttribute('aria-current');
  }
}
const terminalStages = new Set(['live', 'draftLive', 'excluded', 'superseded', 'failed', 'disabled']);
async function checkProgress(manual = false) {
  if (!api || !pending || checking || (document.hidden && !manual)) return;
  clearTimeout(pollTimer);
  if (manual) { pending.started = Date.now(); savePending(); }
  if (!manual && terminalStages.has(progressState.stage)) return;
  if (!manual && Date.now() - pending.started > 20 * 60 * 1000) {
    progressState = { stage: 'timeout' }; renderProgress(); return;
  }
  checking = true;
  const client = api, current = pending, epoch = pollEpoch;
  $('check-status').disabled = true;
  try {
    let receipt = null;
    try {
      const response = await fetch(`deployment.json?check=${Date.now()}`, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(12000) });
      if (response.ok) receipt = await response.json();
    } catch { /* A missing or delayed receipt is expected before the first deployment. */ }
    const result = await deploymentStatus(client, current, receipt);
    if (client !== api || epoch !== pollEpoch || current !== pending) return;
    progressState = result;
    pending.stage = result.stage; savePending();
  } catch {
    if (client !== api || epoch !== pollEpoch || current !== pending) return;
    progressState = { stage: 'unverified' };
  } finally {
    checking = false;
    $('check-status').disabled = busy;
    renderProgress();
    if (api && pending && !terminalStages.has(progressState.stage) && !document.hidden) {
      pollTimer = setTimeout(() => checkProgress(), epoch === pollEpoch ? 15000 : 0);
    }
  }
}
async function save(action, retract = false) {
  if (busy) return;
  try {
    if (tab === 'info') syncInformation();
    const post = readPost(documentText);
    if (typeof post.metadata.title !== 'string' || !post.metadata.title.trim()) throw new Error(t('invalidTitle'));
    postPath($('path').value.trim());
  } catch (error) { notice(`${t('error')}${error.message}`, true); return; }
  if (!confirm(t(retract ? 'retractConfirm' : action === 'publish' ? 'publishConfirm' : 'draftConfirm'))) return;
  await run(async () => {
    let result;
    try {
      await flushBackup(true);
      const images = await Promise.all(activeAssets().filter(asset => !asset.uploaded).map(encodedImage));
      result = await api.save({ originalPath, originalSha, path: $('path').value.trim(), text: documentText, action, images });
    } catch (error) {
      backup(); throw new Error(`${error.message}\n${t('unknownSave')}`);
    }
    assets.forEach(asset => { if (documentText.includes(asset.url)) asset.uploaded = true; });
    await showEditor(result.path, result.text, result.path, result.sha, undefined, { session: backupSession, assets });
    backupSession.touched = true;
    if (await flushBackup(true)) backupSession.touched = false;
    const post = readPost(result.text);
    cache.set(result.sha, { text: result.text, post });
    clearTimeout(pollTimer); ++pollEpoch;
    pending = { path: result.path, sha: result.sha, commit: result.commit, action,
      title: post.metadata.title, url: action === 'publish' ? articleURL(result.path, post.metadata) : null, started: Date.now() };
    savePending(); progressState = { stage: 'queued' }; renderProgress(); setView('result');
    // The successful commit must remain successful even if refreshing the list fails.
    try { await refresh(); } catch { /* The list can be refreshed independently. */ }
  });
  if (pending) void checkProgress();
}
function updateViewport() {
  const geometry = viewportGeometry(window.visualViewport, window.innerHeight);
  document.documentElement.style.setProperty('--editor-top', `${geometry.top}px`);
  const navHeight = Math.ceil(document.querySelector('.site-header').getBoundingClientRect().height);
  document.documentElement.style.setProperty('--nav-height', `${navHeight}px`);
  document.documentElement.style.setProperty('--editor-height', `${Math.max(1, geometry.height - navHeight)}px`);
  document.body.dataset.keyboard = String(geometry.height < window.innerHeight * .8 && (window.visualViewport?.scale || 1) < 1.2);
}

$('locale').addEventListener('click', () => {
  locale = locale === 'zh' ? 'en' : 'zh';
  try { localStorage.setItem(localeKey, locale); } catch { /* The selected language still applies to this page. */ }
  for (const id of ['search', 'filter-category', 'filter-tag', 'filter-year']) $(id).value = '';
  renderLocale();
  if (api && view === 'library') void hydrate(api);
});
$('editor-home').addEventListener('click', event => { event.preventDefault(); if (!busy) void openHome(); });
document.querySelectorAll('[data-open-section]').forEach(button => button.addEventListener('click', () => void openSection(button.dataset.openSection)));
for (const [home, target] of [['home-resume', 'resume'], ['home-progress', 'progress'], ['home-backups', 'restore'], ['home-logout', 'logout']]) {
  $(home).addEventListener('click', () => $(target).click());
}
document.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => void openSection(button.dataset.section)));
$('data-export').addEventListener('click', () => dataEditor.export());
$('data-reload').addEventListener('click', () => { if (confirm(dataEditor.text('reload'))) void run(async () => { await dataEditor.open(section, true); }); });
$('data-publish').addEventListener('click', () => void run(() => dataEditor.publish()));
for (const id of ['search', 'filter-state', 'filter-category', 'filter-tag', 'filter-year']) $(id).addEventListener(id === 'search' ? 'input' : 'change', renderCards);
function renderConnection() {
  const remembered = authMode === 'token' && Boolean(credentials.read());
  $('saved-login').hidden = !remembered;
  $('reauth').hidden = authMode !== 'github';
  $('logout').textContent = t(authMode === 'github' ? 'signOut' : 'logout');
  $('connection-status').textContent = authMode === 'github' ? `${t('signedInAs')} ${accountLogin}` : t(remembered ? 'deviceRemembered' : 'sessionOnly');
  $('home-connection').textContent = $('connection-status').textContent;
  $('home-logout').textContent = $('logout').textContent;
}
async function connect(token, remember, automatic = false) {
  await run(async () => {
    if (automatic) notice(t('autoConnecting'));
    api = new GitHub(token); api.readCache = new RepositoryCache(); $('token').value = '';
    try { await refresh(); } catch (error) {
      api.token = ''; api = null; ++libraryEpoch; files = []; cache.clear();
      if (error.status === 401) {
        const cleared = credentials.clear(); renderConnection();
        throw new Error(t(cleared ? 'tokenExpired' : 'forgetFailed'));
      }
      renderConnection();
      throw error;
    }
    const stored = remember ? credentials.save(token) : credentials.clear();
    await connected();
    if (!stored) notice(t(remember ? 'rememberFailed' : 'forgetFailed'), true);
  });
}
async function connected() {
  renderConnection();
  try { await backups.migrate(); } catch { /* Existing local backups are retained if migration is unavailable. */ }
  restorePending();
  section = 'blog'; renderNavigation();
  const active = pending && !terminalStages.has(progressState.stage);
  setView(active ? 'result' : 'home', false);
  if (active) { renderProgress(); void checkProgress(true); }
}
$('reauth').addEventListener('click', async () => {
  if (await mayReplace()) location.assign('/admin/auth/login');
});
$('login-form').addEventListener('submit', event => {
  event.preventDefault();
  void connect($('token').value.trim(), $('remember-device').checked);
});
$('retry-saved').addEventListener('click', () => {
  const token = credentials.read();
  if (token) void connect(token, true, true);
});
$('forget-saved').addEventListener('click', () => {
  const cleared = credentials.clear(); $('remember-device').checked = false;
  renderConnection(); notice(t(cleared ? 'forgotten' : 'forgetFailed'), !cleared);
});
$('refresh').addEventListener('click', () => run(refresh));
$('new').addEventListener('click', () => {
  $('new-title').value = ''; $('language').value = locale;
  $('slug').value = `note-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36).slice(-4)}`;
  setView('new'); $('new-title').focus();
});
$('cancel-new').addEventListener('click', () => setView('library'));
$('new-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !await mayReplace()) return;
  try {
    const topic = $('topic').value.trim(), slug = $('slug').value.trim();
    if (!topic || topic.split('/')[0] === 'drafts' || !slug || slug.includes('/') || slug.endsWith('.md')) throw new Error(t('invalidSlug'));
    const title = $('new-title').value.trim(); if (!title) throw new Error(t('invalidTitle'));
    const path = postPath(`content/blog/${$('language').value}/drafts/${topic}/${slug}.md`);
    await showEditor(path, newPost(title), null, null, 'draft');
    changed(); $('source').focus();
  } catch (error) { notice(`${t('error')}${error.message}`, true); }
});
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => selectTab(button.dataset.tab));
$('source').addEventListener('input', () => {
  try { documentText = updatePost(documentText, {}, $('source').value); changed(); updateImageTray(); }
  catch (error) { notice(`${t('error')}${error.message}`, true); }
});
for (const id of ['title', 'date', 'tags', 'categories']) $(id).addEventListener('input', () => {
  try {
    syncInformation();
    changed(); renderEditorHeading();
  } catch (error) { notice(`${t('error')}${error.message}`, true); }
});
$('raw-source').addEventListener('input', () => { documentText = $('raw-source').value; changed(); renderEditorHeading(); });
$('path').addEventListener('input', changed);
$('back').addEventListener('click', async () => { await flushBackup(true); setView('library'); });
$('resume').addEventListener('click', () => setView('editor'));
$('restore').addEventListener('click', showBackups);
$('editor-backups').addEventListener('click', showBackups);
$('backups-refresh').addEventListener('click', showBackups);
$('backups-back').addEventListener('click', () => setView(backupsReturn));
$('backup-copy').addEventListener('click', async () => {
  await backupQueue.catch(() => {});
  backupSession = { id: crypto.randomUUID(), revision: 0 }; assets.forEach(asset => { asset.persisted = false; });
  backupSession.touched = true;
  const saved = await flushBackup(true); $('more-menu').open = false;
  notice(t(saved ? 'backupCopied' : 'backupFailed'), !saved);
});
function syncPreviewTheme() {
  const root = $('preview-frame').contentDocument?.documentElement;
  if (root) root.dataset.theme = document.documentElement.dataset.theme;
}
window.addEventListener('editor-theme-change', syncPreviewTheme);
$('preview-frame').addEventListener('load', syncPreviewTheme);
for (const button of document.querySelectorAll('[data-insert]')) {
  button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('click', () => {
    const input = $('source'), result = insertMarkup(input.value, input.selectionStart, input.selectionEnd, button.dataset.insert);
    input.value = result.text; input.focus(); input.setSelectionRange(result.start, result.end); input.dispatchEvent(new Event('input'));
  });
}
$('insert-image').addEventListener('click', () => {
  imageSelection = { start: $('source').selectionStart, end: $('source').selectionEnd }; $('image-input').click();
});
$('image-input').addEventListener('change', chooseImages);
$('save-draft').addEventListener('click', () => save('draft'));
$('publish').addEventListener('click', () => save('publish'));
$('retract').addEventListener('click', () => save('draft', true));
$('progress').addEventListener('click', () => { setView('result'); renderProgress(); void checkProgress(true); });
$('check-status').addEventListener('click', () => checkProgress(true));
$('continue-editing').addEventListener('click', () => { if (pending?.kind) { void openSection(pending.kind); return; } if (documentText) setView('editor'); else void showBackups(); });
$('result-back').addEventListener('click', () => void openSection('blog'));
$('export').addEventListener('click', () => {
  download(new Blob([documentText], { type: 'text/markdown;charset=utf-8' }), $('path').value.split('/').at(-1) || 'article.md'); $('more-menu').open = false;
});
$('logout').addEventListener('click', async () => {
  if (!await mayReplace() || (dataEditor.dirty && !dataEditor.backup())) return;
  if (authMode === 'github') {
    try { await api.logout(); }
    catch { notice(t('signOutFailed'), true); return; }
  }
  ++libraryEpoch; ++pollEpoch; clearTimeout(pollTimer);
  if (api) { await api.readCache?.clear(); api.token = ''; } api = null; accountLogin = '';
  files = []; cache.clear(); documentText = ''; originalPath = null; originalSha = null;
  $('source').value = ''; $('raw-source').value = ''; $('path').value = '';
  dirty = false; pending = null; dataEditor.clear(); section = 'blog'; renderNavigation();
  clearTimeout(backupTimer); resetImageURLs(); backupSession = null; assets = [];
  const cleared = credentials.clear(); $('remember-device').checked = false;
  renderConnection(); setView('login', false); notice(t(authMode === 'github' ? 'signedOut' : cleared ? 'disconnected' : 'forgetFailed'), authMode === 'token' && !cleared);
});
window.addEventListener('popstate', event => {
  const next = event.state?.editorView;
  if (next === 'data' && ['cv', 'publications'].includes(event.state?.section)) { void openSection(event.state.section, false); return; }
  if (next === 'home') { void openHome(false); return; }
  if (['login', 'library', 'editor', 'new', 'result', 'backups', 'data'].includes(next)) setView(api && next === 'login' ? 'home' : next, false);
});
window.addEventListener('beforeunload', event => { if (dirty || busy || dataEditor.dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { clearTimeout(pollTimer); if (dirty) void flushBackup(true); });
window.addEventListener('pageshow', () => { updateViewport(); if (api && pending) void checkProgress(true); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(pollTimer); if (dirty) void flushBackup(true); }
  else if (api && pending) void checkProgress(true);
});
window.visualViewport?.addEventListener('resize', updateViewport);
window.visualViewport?.addEventListener('scroll', updateViewport);
window.addEventListener('resize', updateViewport);
// Fonts, safe-area changes and compact header styles can resize navigation independently.
new ResizeObserver(updateViewport).observe(document.querySelector('.site-header'));
renderLocale(); setView('login', false);
async function initializeLogin() {
  let configuration;
  await run(async () => {
    const config = configuration = await authConfiguration(); authMode = config.mode;
    const github = authMode === 'github';
    $('github-login-panel').hidden = !github && !config.loginURL;
    $('login-form').hidden = github;
    $('github-login').href = github ? '/admin/auth/login' : config.loginURL || '#';
    $('github-login').hidden = github && !config.ready;
    $('login-retry').hidden = false;
    renderConnection();
    if (github) {
      if (!config.ready) { notice(t('githubNotReady'), true); return; }
      const errorCode = new URL(location.href).searchParams.get('auth_error');
      if (errorCode) {
        const key = { invalid_state: 'loginStateError', cancelled: 'loginCancelled', account_not_allowed: 'accountNotAllowed', installation_required: 'installationRequired' }[errorCode] || 'loginUnavailable';
        history.replaceState(history.state, '', location.pathname + location.hash);
        notice(t(key), true); return;
      }
      let session;
      try { session = await authRequest('session'); }
      catch (error) { if (error.status === 401) return; throw error; }
      api = new SessionGitHub(session, t('sessionExpired')); api.readCache = new RepositoryCache(); accountLogin = session.login;
      try { listing = true; await connected(); await refresh(); }
      catch (error) { api = null; accountLogin = ''; throw error; }
    }
  });
  if (!configuration || (authMode === 'token' && !$('github-login-panel').hidden)) return;
  const token = authMode === 'token' && credentials.read();
  if (token) void connect(token, true, true);
}
$('login-retry').addEventListener('click', initializeLogin);
void initializeLogin();
