// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
import { GitHub, newPost, postPath, readPost, updatePost, articleState, articleURL } from './core.mjs?v=3';
import { deploymentStatus, viewportGeometry } from './deployment.mjs?v=3';
import { messages } from './messages.mjs?v=3';
import { BackupStore } from './backups.mjs?v=3';
import { drawBackups } from './backup-ui.mjs?v=3';
import { prepareImage, encodedImage, insertMarkup, MAX_IMAGES, MAX_TOTAL_BYTES } from './media.mjs?v=3';
import { renderPreview } from './preview.mjs?v=3';

const $ = id => document.getElementById(id);
const pendingKey = 'yicai-blog-publication-v1', backups = new BackupStore();
const sourceRepo = 'https://github.com/escapetiger/hugo-yicai';
let locale = navigator.language.startsWith('zh') ? 'zh' : 'en';
let api, files = [], cache = new Map(), libraryEpoch = 0, view = 'login', tab = 'body';
let documentText = '', originalPath = null, originalSha = null, savedState = 'draft', dirty = false, busy = false;
let pending = null, progressState = { stage: 'queued' }, pollTimer, checking = false, pollEpoch = 0;
let backupSession = null, assets = [], backupTimer, backupQueue = Promise.resolve(), backupsReturn = 'library';
let imageSelection = { start: 0, end: 0 }, objectURLs = new Map();
const t = key => messages[locale][key];
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
  document.body.dataset.view = next;
  document.querySelectorAll('.view').forEach(node => { node.hidden = node.id !== `${next}-view`; });
  $('resume').hidden = !documentText;
  $('progress').hidden = !pending;
  $('more-menu').open = false;
  notice();
  const state = { editorView: next };
  if (push) history.pushState(state, '', `#${next}`);
  else history.replaceState(state, '', `#${next}`);
  if (next !== 'editor') window.scrollTo(0, 0);
  updateViewport();
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
  // Keep export available even when a network request is pending.
  document.querySelectorAll('button, input, select, textarea').forEach(node => {
    if (node.id !== 'export') node.disabled = value;
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
  document.documentElement.lang = locale; $('locale').value = locale;
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
  $('search').placeholder = t('search');
  $('source').placeholder = t('bodyHint');
  renderCards(); renderEditorHeading(); renderProgress();
  $('preview-frame').title = t('preview');
  if (tab === 'preview') updatePreview();
  if (view === 'backups') void showBackups();
}
function renderCards() {
  const term = $('search').value.toLocaleLowerCase();
  const lang = $('filter-language').value, state = $('filter-state').value;
  const filtered = files.filter(file => {
    const post = cache.get(file.sha)?.post;
    const title = typeof post?.metadata.title === 'string' ? post.metadata.title : '';
    return (!lang || file.path.split('/')[2] === lang) &&
      (!state || articleState(file.path, post?.metadata) === state) &&
      `${title} ${file.path}`.toLocaleLowerCase().includes(term);
  });
  const cards = filtered.map(file => {
    const entry = cache.get(file.sha), metadata = entry?.post?.metadata;
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'article-card'; card.dataset.path = file.path;
    const top = document.createElement('span'); top.className = 'card-top';
    const language = document.createElement('span'); language.textContent = file.path.split('/')[2] === 'zh' ? '中文' : 'ENGLISH';
    const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = t(articleState(file.path, metadata));
    top.append(language, badge);
    const title = document.createElement('strong');
    title.textContent = typeof metadata?.title === 'string' ? metadata.title : file.path.split('/').at(-1).replace(/\.md$/, '');
    const detail = document.createElement('span'); detail.className = 'card-path';
    detail.textContent = entry?.error ? t('retryArticle') : file.path.replace('content/blog/', '');
    card.append(top, title, detail);
    card.addEventListener('click', () => openArticle(file));
    return card;
  });
  if (!cards.length) {
    const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = t('noArticles'); cards.push(empty);
  }
  $('articles').replaceChildren(...cards);
  const missing = files.some(file => !cache.has(file.sha));
  $('library-count').textContent = `${filtered.length} ${t('articlesUnit')}${missing ? ` · ${t('loading')}` : ''}`;
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
async function hydrate(client, epoch) {
  const unloaded = files.filter(file => !cache.has(file.sha));
  for (let i = 0; i < unloaded.length; i += 3) {
    if (client !== api || epoch !== libraryEpoch) return;
    const group = unloaded.slice(i, i + 3);
    const results = await Promise.allSettled(group.map(file => readArticle(client, file)));
    if (client !== api || epoch !== libraryEpoch) return;
    results.forEach((result, index) => cache.set(group[index].sha,
      result.status === 'fulfilled' ? result.value : { error: result.reason.message }));
    renderCards();
  }
}
async function refresh() {
  const client = api, epoch = ++libraryEpoch;
  const snapshot = await client.snapshot();
  if (client !== api || epoch !== libraryEpoch) return;
  files = snapshot.files.filter(file => {
    try { postPath(file.path); return file.type === 'blob' && file.mode === '100644'; }
    catch { return false; }
  }).sort((a, b) => a.path.localeCompare(b.path));
  renderCards();
  void hydrate(client, epoch);
}
function renderEditorHeading() {
  let title;
  try { title = readPost(documentText).metadata.title; } catch { /* Raw edits may temporarily be invalid. */ }
  $('editor-title').textContent = typeof title === 'string' && title.trim() ? title : t('emptyTitle');
  $('article-state').textContent = t(savedState);
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
function updatePreview() {
  try {
    const post = readPost(documentText), path = $('path').value.replace(/^(content\/blog\/(en|zh)\/)drafts\//, '$1');
    const base = new URL(articleURL(path, post.metadata) || '/', location.origin).href;
    const images = new Map(activeAssets().map(asset => [new URL(asset.url, location.origin).href, localImageURL(asset)]));
    renderPreview($('preview-frame'), { body: post.body, title: post.metadata.title || '', base, images, locale });
  } catch (error) { notice(`${t('error')}${error.message}`, true); }
}
async function showBackups() {
  if (view !== 'backups') { backupsReturn = view === 'editor' ? 'editor' : 'library'; await flushBackup(true); setView('backups'); }
  try {
    try { await backups.migrate(); } catch { notice(t('invalidBackup'), true); }
    await backups.collect();
    const records = await backups.list();
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
    notice(saved ? t('imageHelp') : t('backupFailed'), !saved);
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
    postPath(record.path);
    if (record.url && (typeof record.url !== 'string' || !record.url.startsWith('/') || record.url.startsWith('//'))) return;
    pending = record;
    progressState = terminalStages.has(record.stage) ? { stage: record.stage, url: record.url } : { stage: 'queued' };
  } catch { /* Ignore unavailable storage or invalid recovery data. */ }
}
function renderProgress() {
  if (!pending) return;
  const stage = progressState.stage;
  $('result-title').textContent = typeof pending.title === 'string' ? pending.title : pending.path;
  $('result-status').textContent = t(stage); $('result-help').textContent = t(`${stage}Help`);
  $('commit-link').href = `${sourceRepo}/commit/${pending.commit}`;
  const logs = progressState.logs;
  $('build-link').href = typeof logs === 'string' &&
    [sourceRepo, 'https://github.com/escapetiger/escapetiger.github.io'].some(repo => logs.startsWith(`${repo}/actions/runs/`))
    ? logs : `${sourceRepo}/actions/workflows/mobile-publish.yml`;
  $('view-article').hidden = stage !== 'live';
  if (stage === 'live') {
    const url = new URL(progressState.url, location.origin);
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
  document.documentElement.style.setProperty('--editor-height', `${geometry.height}px`);
  document.body.dataset.keyboard = String(geometry.height < window.innerHeight * .8 && (window.visualViewport?.scale || 1) < 1.2);
}

$('locale').addEventListener('change', () => { locale = $('locale').value; renderLocale(); });
for (const id of ['search', 'filter-language', 'filter-state']) $(id).addEventListener(id === 'search' ? 'input' : 'change', renderCards);
$('login-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    api = new GitHub($('token').value.trim()); $('token').value = '';
    try { await refresh(); } catch (error) { api.token = ''; api = null; throw error; }
    try { await backups.migrate(); } catch { /* Existing local backups are retained if migration is unavailable. */ }
    restorePending();
    const active = pending && !terminalStages.has(progressState.stage);
    setView(active ? 'result' : 'library', false);
    if (active) { renderProgress(); void checkProgress(true); }
  });
});
$('refresh').addEventListener('click', () => run(refresh));
$('new').addEventListener('click', () => {
  $('new-title').value = '';
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
$('preview-frame').addEventListener('load', () => { if (tab === 'preview' && documentText) updatePreview(); });
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
$('continue-editing').addEventListener('click', () => { if (documentText) setView('editor'); else void showBackups(); });
$('result-back').addEventListener('click', () => setView('library'));
$('export').addEventListener('click', () => {
  download(new Blob([documentText], { type: 'text/markdown;charset=utf-8' }), $('path').value.split('/').at(-1) || 'article.md'); $('more-menu').open = false;
});
$('logout').addEventListener('click', async () => {
  if (!await mayReplace()) return;
  ++libraryEpoch; ++pollEpoch; clearTimeout(pollTimer);
  if (api) api.token = ''; api = null;
  files = []; cache.clear(); documentText = ''; originalPath = null; originalSha = null;
  $('source').value = ''; $('raw-source').value = ''; $('path').value = '';
  dirty = false; pending = null;
  clearTimeout(backupTimer); resetImageURLs(); backupSession = null; assets = [];
  setView('login', false); notice(t('disconnected'));
});
window.addEventListener('popstate', event => {
  const next = event.state?.editorView;
  if (['login', 'library', 'editor', 'new', 'result', 'backups'].includes(next)) setView(api && next === 'login' ? 'library' : next, false);
});
window.addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { clearTimeout(pollTimer); if (dirty) void flushBackup(true); });
window.addEventListener('pageshow', () => { updateViewport(); if (api && pending) void checkProgress(true); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(pollTimer); if (dirty) void flushBackup(true); }
  else if (api && pending) void checkProgress(true);
});
window.visualViewport?.addEventListener('resize', updateViewport);
window.visualViewport?.addEventListener('scroll', updateViewport);
window.addEventListener('resize', updateViewport);
renderLocale(); setView('login', false);
