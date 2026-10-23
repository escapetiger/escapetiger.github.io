// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
import { scopedDocument, retainScopedSection } from './document-scope.mjs?v=29';
import { saveDraft, readDraft, draftScopes, mergeArticle, retainArticle, deleteArticle } from './working-drafts.mjs?v=29';
import { BlockEditor } from './blocks.mjs?v=29';
import { markdownRenderer } from './preview.mjs?v=29';
import { referenceRows, serializeReferences, addReference } from './references.mjs?v=29';
import { articleSections, replaceArticleSection } from './article-sections.mjs?v=29';
import { newPost, postPath, readPost, updatePost, articleState, articleURL } from './core.mjs?v=29';
import { deploymentStatus, viewportGeometry } from './deployment.mjs?v=29';
import { messages } from './messages.mjs?v=29';
import { BackupStore } from './backups.mjs?v=29';
import { drawBackups } from './backup-ui.mjs?v=29';
import { prepareImage, encodedImage, MAX_IMAGES, MAX_TOTAL_BYTES } from './media.mjs?v=29';
import { renderPreview } from './preview.mjs?v=29';
import { RepositoryCache } from './read-cache.mjs?v=29';
import { loadPreview, loadEditorResources } from './preview-loader.mjs?v=29';
import { authConfiguration, authRequest, SessionGitHub, siteOrigin } from './auth.mjs?v=29';
import { preferredLocale, localeKey, articleLanguage, taxonomyTerms, articleDate, articleSummary, selectArticles } from './library.mjs?v=29';
import { entryFrom, pagePath } from './routes.mjs?v=29';

import { DataEditor, dataPath } from './data-editor.mjs?v=29';
import { StructuredEditor } from './structured-editor.mjs?v=30';

const parameters = new URL(location.href).searchParams;
const embedded = parameters.get('embedded') === '1' && window.parent !== window;
const entry = entryFrom(parameters);
const returnPage = pagePath(parameters.get('return')) || (parameters.has('page') ? entry.page : `/${preferredLocale(navigator.language)}/`);
const tellParent = message => { if (embedded) window.parent.postMessage(message, location.origin); };
document.body.dataset.embedded = String(embedded);
let safeToLeave = false, publishing = false;
const $ = id => document.getElementById(id);
const pendingKey = 'yicai-blog-publication-v1', backups = new BackupStore();
const sourceRepo = 'https://github.com/escapetiger/hugo-yicai';
let locale = embedded || parameters.has('return') ? entry.lang : preferredLocale(navigator.language);
let selectedReference = null;
let workingDraft = null, cloudDrafts = new Map(), cloudFiles = [], cloudTask = null, cloudLoaded = false, cloudEpoch = 0;
let baseline, previewTimer, previewEpoch = 0;
let api, files = [], cache = new Map(), libraryEpoch = 0, hydrationEpoch = 0, listing = false, view = 'login', tab = 'body';
let documentText = '', originalPath = null, originalSha = null, savedState = 'draft', dirty = false, busy = false;
let pending = null, progressState = { stage: 'queued' }, pollTimer, checking = false, pollEpoch = 0;
let backupSession = null, assets = [], backupTimer, backupQueue = Promise.resolve(), backupsReturn = 'library';
let imageSelection = { start: 0, end: 0 }, objectURLs = new Map(), libraryFrame = 0;
const t = key => messages[locale][key];
const word = (en, zh) => locale === 'zh' ? zh : en;
const blockEditor = new BlockEditor($('block-editor'), { locale: () => locale, change(body) { $('source').value = body; documentText = updatePost(documentText, {}, replaceArticleSection(readPost(documentText).body, 'body', body, locale)); changed(); } });
let section = 'home';
function sectionPublished(result, keepView = false) {
  clearTimeout(pollTimer); ++pollEpoch;
  const file = result.files.find(file => file.path === dataPath(result.kind, locale));
  pending = { ...file, files: result.files, kind: result.kind, commit: result.commit, action: 'publish',
    title: t({ home: 'homeHeading', cv: 'navCV', publications: 'navPublications' }[result.kind]), sourcePage: entry.page,
    url: `/${locale}/${result.kind === 'home' ? '' : `${result.kind}/`}`, started: Date.now() };
  previewHome();
  savePending(); progressState = { stage: 'queued' }; renderProgress(); if (!keepView) setView('result'); void checkProgress();
}
const dataEditor = new StructuredEditor({ root: $('data-content'), locale: () => locale, api: () => api,
  notify(message, error) { safeToLeave = false; if (error || !embedded) notice(message, error); }, published: result => sectionPublished(result, true), selectionChanged(context) {
    $('data-export').disabled = !context.selected;
    $('data-reload').disabled = busy || !context.dirty;
    $('data-publish').disabled = busy || !context.dirty || context.legacyBlocked;

  } });
const homeEditor = new DataEditor({ root: $('home-fields'), locale: () => locale, api: () => api,
  notify(message, error) { safeToLeave = false; if (error || !embedded) notice(message, error); previewHome(); }, published: sectionPublished });
function previewHome() {
  const profile = homeEditor.records?.[locale]?.value;
  if (profile) tellParent({ type: 'editor-preview', value: profile });
}
async function openHome(push = true) {
  if (!api) { setView('login', push); return; }
  await run(async () => {
    if (!await mayReplace() || (dataEditor.dirty && !dataEditor.backup()) || (homeEditor.dirty && !homeEditor.backup())) return;
    setView('home', push);
  });
}
async function openSection(next, push = true) {
  if (!api) { setView('login'); return; }
  await run(async () => {
    if (!await mayReplace()) return;
    if ((dataEditor.dirty && !dataEditor.backup()) || (homeEditor.dirty && !homeEditor.backup())) return;
    if (next !== 'blog') {
      ++hydrationEpoch; notice(`${t('loading')} ${t(next === 'cv' ? 'navCV' : 'navPublications')}`);
      await dataEditor.open(next);
    }
    section = next; setView(next === 'blog' ? 'library' : 'data', push);
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
  if (next !== 'editor') { clearTimeout(previewTimer); ++previewEpoch; }
  if (next !== 'library') ++hydrationEpoch;
  if (['library', 'editor', 'new', 'backups'].includes(next)) section = 'blog';
  if (next === 'result') section = pending?.kind || 'blog';
  if (['home', 'login'].includes(next)) section = next;
  previewHome();

  document.body.dataset.view = next;
  if (next === 'editor') window.scrollTo(0, 0);
  document.querySelectorAll('.view').forEach(node => { node.hidden = node.id !== `${next}-view`; });
  renderWorkspace();
  notice();
  const state = { editorView: next, section };
  if (!embedded) {
    if (push) history.pushState(state, '', `#${next}`);
    else history.replaceState(state, '', `#${next}`);
  }
  if (next !== 'editor') window.scrollTo(0, 0);
  updateViewport();
  if (next === 'library' && api) void hydrate(api);
}
async function run(task) {
  if (busy) return;
  busy = true;
  setBusy(true);
  notice();
  try { await task(); } catch (error) { notice(`${t('error')}${error.message}`, true); if (error.status === 401) tellParent({ type: 'editor-login' }); }
  finally { busy = false; publishing = false; setBusy(false); }
}
function setBusy(value) {
  $('editor-home').setAttribute('aria-disabled', String(value));
  // Keep export available even when a network request is pending.
  document.querySelectorAll('button, input, select, textarea').forEach(node => {
    if (!['export', 'data-export', 'home-export', 'locale', 'theme-toggle'].includes(node.id) && node.dataset.fileAction !== 'data-export') node.disabled = value;
  });
  document.querySelectorAll('.view').forEach(node => node.setAttribute('aria-busy', String(value && !node.hidden)));
  if (view === 'data') $('locale').disabled = value;
  if (!value && dataEditor.records) dataEditor.updateSelection();
}
async function mayReplace() { return !dirty || await flushBackup(true) || confirm(t('discard')); }
function activeAssets() { return assets.filter(asset => documentText.includes(asset.url)); }
function queueBackup(checkpoint = false) {
  if (!documentText || !backupSession || (backupSession.suppressed && !backupSession.touched) || (!dirty && !backupSession.touched)) return Promise.resolve();
  const session = backupSession, images = activeAssets();
  const record = { id: session.id, path: $('path').value, text: documentText, originalPath, originalSha, savedState, dirty,
    workingDraft,
    assets: images.map(({ path, url, name, uploaded }) => ({ path, url, name, uploaded })) };
  const task = backupQueue.catch(() => {}).then(async () => {
    const saved = await backups.save(record, session.revision, images.filter(asset => !asset.persisted), checkpoint);
    session.revision = saved.revision;
    images.forEach(asset => { asset.persisted = true; });
    if (session === backupSession) $('backup-status').textContent = navigator.onLine ? t('backup') : word('Offline · backed up on this device', '离线 · 已备份到本机');
  });
  backupQueue = task;
  task.catch(error => { if (session === backupSession) { const message = t(error.code === 'BACKUP_CONFLICT' ? 'backupConflict' : 'backupFailed'); $('backup-status').textContent = message; notice(message, true); } });
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
function changed() { safeToLeave = false; dirty = true; if (backupSession) { backupSession.touched = true; backupSession.suppressed = false; } backup(); schedulePreview(); }
function schedulePreview() { clearTimeout(previewTimer); if (view === 'editor') previewTimer = setTimeout(() => void updatePreview(), 160); }
function renderWorkspace() {
  const editing = view === 'editor';
  $('workspace-title').textContent = t(editing ? 'body' : section === 'cv' ? 'navCV' : section === 'publications' ? 'navPublications' : section === 'blog' ? 'navBlog' : view === 'login' ? 'loginHeading' : 'homeHeading');
  $('workspace-title').hidden = editing; $('workspace-tabs').hidden = !editing;
  $('article-preview-toggle').hidden = !editing || document.body.dataset.compact !== 'true';
  tellParent({ type: 'editor-workspace', article: editing, path: originalPath || $('path').value });
  if (editing) schedulePreview();
}
function renderLocale() {
  if (api instanceof SessionGitHub) api.expiredMessage = t('sessionExpired');
  document.documentElement.lang = locale; $('locale').textContent = locale === 'zh' ? 'En' : 'Zh';
  $('locale').setAttribute('aria-label', locale === 'zh' ? 'Switch to English' : '切换为中文');
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
  $('search').placeholder = t('search');
  renderLibraryFilters(); renderCards(); renderProgress();
  $('theme-toggle').setAttribute('aria-label', t('toggleTheme'));
  $('theme-toggle').title = t('toggleTheme');
  $('preview-frame').title = t('preview');
  previewHome();
  $('abstract-source').placeholder = t('abstractPlaceholder');
  renderWorkspace();
  if (view === 'backups') void showBackups();
  if (view === 'data') dataEditor.render();
  if (view === 'home') homeEditor.render();

  if (busy) setBusy(true);
}
function libraryFiles() {
  const result = files.filter(file => !cloudDrafts.get(file.path)?.archived);
  for (const draft of cloudDrafts.values()) {
    const existing = result.find(file => file.path === (draft.originalPath || draft.path));
    if (existing) { existing.working = draft; }
    else result.push({ path: draft.path, sha: draft.sha, type: 'blob', working: draft, cloudOnly: true });
  }
  return result;
}
function libraryCache() {
  const result = new Map(cache); for (const draft of cloudDrafts.values()) { const file = files.find(file => file.path === (draft.originalPath || draft.path)); result.set(file?.sha || draft.sha, { text: draft.text, post: readPost(draft.text) }); } return result;
}
function renderLibraryFilters() {
  const posts = libraryFiles().filter(file => articleLanguage(file.path) === locale).map(file => libraryCache().get(file.sha)?.post?.metadata || {});
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
  const all = libraryFiles(), effective = libraryCache(), state = $('filter-state').value;
  const filtered = selectArticles(all.filter(file => state === 'trash' ? file.working?.archived : !file.working?.archived), effective, { language: locale, term: $('search').value, state: ['changed', 'trash'].includes(state) ? '' : state,
    category: $('filter-category').value, tag: $('filter-tag').value, year: $('filter-year').value }).filter(file => state !== 'changed' || file.working && file.working.text !== file.working.baseText);
  const cards = filtered.map(file => {
    const entry = effective.get(file.sha), metadata = entry?.post?.metadata || {};
    const card = document.createElement('article'); card.className = 'pub-card article-card'; card.dataset.path = file.path; card.lang = locale;
    const state = articleState(file.path, metadata), date = articleDate(metadata, locale);
    const top = document.createElement('div'); top.className = 'pub-card-top';
    const tags = document.createElement('div'); tags.className = 'pub-tags';
    for (const value of taxonomyTerms(metadata.tags)) { const tag = document.createElement('span'); tag.className = 'pub-badge'; tag.textContent = value; tags.append(tag); }
    const time = document.createElement('time'); time.className = 'pub-year'; time.textContent = date?.label || t('undated'); if (date) time.dateTime = date.iso;
    top.append(tags, time);
    const heading = document.createElement('h3'); heading.className = 'pub-title';
    const title = document.createElement('button'); title.type = 'button'; title.textContent = typeof metadata.title === 'string' ? metadata.title : file.path.split('/').at(-1).replace(/\.md$/, '');
    title.addEventListener('click', () => void openArticle(file)); heading.append(title);
    const summary = document.createElement('div'); summary.className = 'pub-venue note-summary'; summary.textContent = articleSummary(entry?.post); summary.hidden = !summary.textContent;
    const footer = document.createElement('div'); footer.className = 'pub-links';
    const kind = document.createElement('span'); kind.className = 'article-kind'; kind.dataset.state = state; kind.textContent = t(state === 'draft' ? 'draftKind' : 'postKind');
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'blog-read-btn'; const pencil = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); pencil.classList.add('blog-edit-pencil'); pencil.setAttribute('viewBox', '0 0 24 24'); pencil.setAttribute('fill', 'none'); pencil.setAttribute('stroke', 'currentColor'); pencil.setAttribute('stroke-width', '1.8'); pencil.setAttribute('stroke-linecap', 'round'); pencil.setAttribute('stroke-linejoin', 'round'); pencil.setAttribute('aria-hidden', 'true');
    const stroke = document.createElementNS(pencil.namespaceURI, 'path'); stroke.setAttribute('d', 'M16 3a2.12 2.12 0 0 1 3 3L8 17l-4 1 1-4L16 3Zm-2 2 3 3M4 21h16'); pencil.append(stroke);
    const editLabel = document.createElement('span'); editLabel.className = 'blog-read-btn-text'; editLabel.textContent = t('editArticle'); edit.append(pencil, editLabel); edit.addEventListener('click', () => void openArticle(file));
    if (file.working && !file.working.archived && file.working.originalPath && file.working.text !== file.working.baseText) kind.textContent += ' · ' + word('Unpublished changes', '未发布修改');
    const menu = document.createElement('details'); menu.className = 'article-options'; const trigger = document.createElement('summary'); trigger.textContent = '···'; trigger.setAttribute('aria-label', word('Article actions', '文章操作')); menu.append(trigger);
    for (const [label, action] of [[word('Export', '导出'), 'export'], [word('Duplicate', '创建副本'), 'duplicate'], [file.working?.archived ? word('Restore', '恢复') : word('Delete', '删除'), file.working?.archived ? 'restore' : 'delete']]) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', () => void libraryAction(file, action)); menu.append(b); }
    if (file.working?.archived) { edit.hidden = true; title.disabled = true; }
    footer.append(kind, menu, edit); card.append(top, heading, summary, footer); return card;
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
  try { await loadCloud(); } catch (error) { notice(error.message, true); }
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
async function loadCloud() {
  if (cloudLoaded) return;
  if (cloudTask) return cloudTask;
  const client = api, epoch = cloudEpoch, inventory = cloudFiles;
  const task = (async () => {
    const next = new Map();
    for (let i = 0; i < inventory.length; i += 3) {
      if (epoch !== cloudEpoch || client !== api) return;
      for (const draft of await Promise.all(inventory.slice(i, i + 3).map(file => readDraft(client, file)))) {
        next.set(draft.originalPath || draft.path, draft); cache.set(draft.sha, { text: draft.text, post: readPost(draft.text) });
      }
    }
    if (epoch !== cloudEpoch || client !== api) return;
    cloudDrafts = next; cloudLoaded = true; renderLibraryFilters(); renderCards();
  })();
  cloudTask = task;
  try { return await task; } finally { if (cloudTask === task) cloudTask = null; }
}
async function libraryAction(file, action) {
  await run(async () => {
    const draft = cloudDrafts.get(file.path), text = draft?.text || (await readArticle(api, file)).text;
    if (action === 'export') { download(new Blob([text], { type: 'text/markdown' }), file.path.split('/').at(-1)); return; }
    if (!await mayReplace()) return;
    if (action === 'duplicate' || action === 'restore') {
      const path = file.path.replace(/^(content\/blog\/(en|zh)\/)(?:drafts\/)?/, '$1drafts/').replace(/\.md$/, `-${crypto.randomUUID().slice(0, 8)}.md`);
      const copy = updatePost(text, { draft: true, title: readPost(text).metadata.title + (action === 'duplicate' ? word(' (copy)', '（副本）') : '') });
      await saveDraft(api, { path, baseText: copy, text: copy });
    } else if (confirm(word('Delete this article from the website? A recoverable copy will remain in Trash.', '从网站删除此文章？可恢复的副本会保留在回收站。'))) {
      if (file.cloudOnly) await saveDraft(api, { path: file.path, baseText: draft.baseText, text, expected: draft, archived: true });
      else await deleteArticle(api, file, draft);
      if (originalPath === file.path || $('path').value === file.path) { documentText = ''; dirty = false; workingDraft = null; }
    }
    await refresh(); await loadCloud();
  });
}
async function refresh() {
  const client = api, epoch = ++libraryEpoch;
  listing = true; renderCards();
  try {
    const snapshot = await client.snapshot();
    if (client !== api || epoch !== libraryEpoch) return;
    cloudFiles = snapshot.files.filter(file => /^\.editor\/drafts\/(en|zh)\/[a-f0-9]{64}\.json$/.test(file.path) && file.mode === '100644'); cloudLoaded = false; ++cloudEpoch; cloudTask = null;
    files = snapshot.files.filter(file => {
      try { postPath(file.path); return file.type === 'blob' && file.mode === '100644'; }
      catch { return false; }
    }).sort((a, b) => a.path.localeCompare(b.path));
    renderLibraryFilters(); renderCards();
    if (view === 'library') void hydrate(client);
  } finally { if (client === api && epoch === libraryEpoch) { listing = false; renderCards(); } }
}
function articleDetails(metadata) {
  return [articleDate(metadata, locale)?.label, ...taxonomyTerms(metadata.categories), ...taxonomyTerms(metadata.tags).map(tag => `#${tag}`)].filter(Boolean).join(' · ');
}
function fieldValue(id, value) { if ($(id).value !== value) $(id).value = value; }
const referenceTitle = text => articleSummary({ body: text.replace(/^\s*\[\d+\]\s*/, '') }) || '…';
function renderReferences(source) {
  const model = referenceRows(source), root = $('reference-rows');
  const expanded = new Set([...root.querySelectorAll('details[open]')].map(node => node.dataset.index));
  root.replaceChildren();
  const commit = () => {
    documentText = updatePost(documentText, {}, replaceArticleSection(readPost(documentText).body, 'references', serializeReferences(model), locale)); changed();
  };
  model.rows.forEach((row, index) => {
    const details = document.createElement('details'); details.className = 'data-entry'; details.dataset.index = String(index); details.open = expanded.has(String(index));
    const summary = document.createElement('summary'), number = document.createElement('span'), title = document.createElement('span');
    number.className = 'data-entry-number'; number.textContent = row.text.match(/^\s*\[(\d+)\]/)?.[1] || String(index + 1).padStart(2, '0');
    title.className = 'data-entry-title'; title.textContent = referenceTitle(row.text); summary.append(number, title);
    const properties = document.createElement('div'); properties.className = 'data-properties';
    const label = document.createElement('label'); label.dataset.property = 'title'; label.textContent = t('citation');
    const input = document.createElement('textarea'); input.rows = 5; input.value = row.text; input.setAttribute('aria-label', `${t('citation')} ${number.textContent}`);
    input.addEventListener('input', () => { row.text = input.value; title.textContent = referenceTitle(input.value); commit(); });
    label.append(input); properties.append(label);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'quiet danger'; remove.textContent = t('removeEntry');
    remove.addEventListener('click', () => { if (!confirm(t('referenceDelete'))) return; model.rows.splice(index, 1); commit(); renderReferences(serializeReferences(model)); });
    details.addEventListener('focusin', () => { selectedReference = row.text.match(/^\s*\[(\d+)\]/)?.[1] || null; });
    details.append(summary, properties, remove); root.append(details);
  });
}
$('reference-add').addEventListener('click', () => {
  const model = referenceRows(articleSections(readPost(documentText).body).references); addReference(model, locale);
  documentText = updatePost(documentText, {}, replaceArticleSection(readPost(documentText).body, 'references', serializeReferences(model), locale)); changed(); renderReferences(serializeReferences(model));
  const item = $('reference-rows').lastElementChild; item.open = true; item.querySelector('textarea').focus();
});
function fillFields() {
  const post = readPost(documentText), meta = post.metadata;
  const parts = articleSections(post.body);
  fieldValue('source', parts.body); blockEditor.render(parts.body); fieldValue('abstract-source', parts.abstract); renderReferences(parts.references);
  $('publication-state').value = meta.draft === true ? 'draft' : 'public';
  $('article-state-label').textContent = t(originalPath && savedState !== 'draft' ? 'postKind' : 'draftKind');
  $('title').value = typeof meta.title === 'string' ? meta.title : '';
  $('date').value = typeof meta.date === 'string' ? meta.date.slice(0, 10) : '';
  $('tags').value = tagsText(meta.tags); $('categories').value = tagsText(meta.categories);
  renderWorkspace();
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
  if (!['file', 'abstract', 'body', 'references'].includes(next)) return false;
  try { fillFields(); }
  catch (error) { notice(`${t('rawInvalid')}\n${error.message}`, true); if (next !== 'file') return false; }
  tab = next;
  document.querySelectorAll('[data-tab]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.tab === next)));
  document.querySelectorAll('[data-panel]').forEach(node => { node.hidden = node.dataset.panel !== next; });
  notice(); schedulePreview();
  document.body.dataset.preview = 'false'; $('article-preview-toggle').setAttribute('aria-pressed', 'false');
  return true;
}
async function showEditor(path, text, loadedPath, sha, state, context, cloud = null) {
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
  workingDraft = cloud;
  baseline = { text: cloud?.text || cache.get(sha)?.text || text, path: loadedPath || path, state: state || articleState(loadedPath || path, readPost(text).metadata) };
  const recovered = !context && existing?.dirty && existing.originalPath === loadedPath && existing.originalSha === sha && articleLanguage(existing.path) === locale ? existing : null;
  if (recovered) { path = recovered.path; text = recovered.text; state = recovered.savedState; workingDraft = recovered.workingDraft || null; }
  selectedReference = null; $('draft-conflict').hidden = true;
  documentText = text; originalPath = loadedPath; originalSha = sha;
  $('path').value = path;
  try { savedState = state || articleState(loadedPath || path, readPost(text).metadata); }
  catch { savedState = state || (path.split('/')[3] === 'drafts' ? 'draft' : 'public'); }
  dirty = Boolean(recovered);
  $('backup-status').textContent = t('localOnly');
  setView('editor');
  void loadEditorResources().then(() => { blockEditor.renderer ||= markdownRenderer(globalThis.markdownit, { renderToString: (source, options) => katex.renderToString(source, { ...options, output: 'mathml' }) }); if (view === 'editor') blockEditor.render(articleSections(readPost(documentText).body).body); }).catch(error => notice(error.message, true));
  tab = 'body';
  if (!selectTab('body')) {
    selectTab('file'); notice(t('rawInvalid'), true);
  }
  renderWorkspace();
  updateImageTray();
  if (!recovered && existing?.dirty && existing.text !== text) notice(t('backupAvailable'));
}
async function openArticle(file) {
  if (file.path === originalPath && documentText && dirty) { setView('editor'); return; }
  if (!await mayReplace()) return;
  await run(async () => {
    ++hydrationEpoch;
    await loadCloud();
    const cloud = cloudDrafts.get(file.path);
    const entry = file.cloudOnly ? { text: cloud.text } : await readArticle(api, file);
    cache.set(file.sha, entry);
    await showEditor(cloud?.path || file.path, cloud?.text || entry.text, cloud ? cloud.originalPath : file.path, cloud ? cloud.originalSha : file.sha, undefined, undefined, cloud);
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
  if (view !== 'editor' || !documentText) return;
  const generation = ++previewEpoch;
  try {
    const frame = $('preview-frame');
    frame.setAttribute('aria-busy', 'true'); if ($('preview-loading')) $('preview-loading').hidden = false;
    await loadPreview(frame);
    if (view !== 'editor' || !documentText || generation !== previewEpoch) return;
    if (!blockEditor.renderer) { blockEditor.renderer = markdownRenderer(globalThis.markdownit, { renderToString: (source, options) => katex.renderToString(source, { ...options, output: 'mathml' }) }); blockEditor.render(articleSections(readPost(documentText).body).body); }
    const post = readPost(documentText), path = $('path').value.replace(/^(content\/blog\/(en|zh)\/)drafts\//, '$1');
    const base = new URL(articleURL(path, post.metadata) || '/', siteOrigin).href;
    const images = new Map(activeAssets().map(asset => [new URL(asset.url, siteOrigin).href, localImageURL(asset)]));
    const rendered = renderPreview($('preview-frame'), { body: post.body, title: post.metadata.title || '', details: articleDetails(post.metadata), base, images, locale });
    if (rendered) { const doc = frame.contentDocument; tellParent({ type: 'editor-article-preview', html: doc.getElementById('content').innerHTML, title: post.metadata.title || '', details: articleDetails(post.metadata), locale }); }
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
    const body = $('source').value;
    const start = Math.min(imageSelection.start, body.length), end = Math.min(imageSelection.end, body.length);
    const markup = prepared.map(asset => `![${asset.name.replace(/\.[^.]+$/, '').replace(/[\[\]\\\n\r]/g, '')}](${asset.url})`).join('\n\n');
    const insert = `\n\n${markup}\n\n`;
    documentText = updatePost(documentText, {}, replaceArticleSection(readPost(documentText).body, 'body', body.slice(0, start) + insert + body.slice(end), locale));
    assets.push(...prepared); dirty = true; backupSession.touched = true; backupSession.suppressed = false; fillFields(); updateImageTray(); schedulePreview();
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
    if (['home', 'cv', 'publications'].includes(record.kind)) {
      if (!['en', 'zh'].some(lang => record.path === dataPath(record.kind, lang)) ||
          !Array.isArray(record.files) || ![1, 2].includes(record.files.length) || new Set(record.files.map(file => file.path)).size !== record.files.length || !record.files.every(file => ['en', 'zh'].some(lang => file.path === dataPath(record.kind, lang)) && /^[0-9a-f]{40}$/.test(file.sha))) return;
    } else postPath(record.path);
    if (record.url && (typeof record.url !== 'string' || !record.url.startsWith('/') || record.url.startsWith('//'))) return;
    pending = record;
    progressState = terminalStages.has(record.stage) ? { stage: record.stage, url: record.url } : { stage: 'queued' };
  } catch { /* Ignore unavailable storage or invalid recovery data. */ }
}
function renderProgress() {
  if (!pending) return;
  const stage = progressState.stage;
  if (view === 'data' && pending.kind === section && !dataEditor.currentDirty()) {
    if (stage === 'live') dataEditor.setStatus(dataEditor.text('live'));
    else if (['failed', 'disabled'].includes(stage)) dataEditor.setStatus(dataEditor.text('deploymentFailed'));
    else if (['timeout', 'unverified', 'excluded'].includes(stage)) dataEditor.setStatus(dataEditor.text('deploymentPending'));
  }
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
    tellParent({ type: 'editor-published', commit: pending.commit, url: progressState.url, page: pending.sourcePage });
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
    if (tab === 'file') syncInformation();
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
      publishing = true;
      workingDraft = await saveDraft(api, { path: $('path').value.trim(), originalPath, originalSha, baseText: workingDraft?.baseText || baseline.text, text: documentText, expected: workingDraft, images });
      documentText = workingDraft.text; originalPath = workingDraft.originalPath; originalSha = workingDraft.originalSha;
      result = await api.save({ originalPath, originalSha, path: $('path').value.trim(), text: documentText, action, images, workingDraft });
    } catch (error) {
      backup(); if (error.code === 'DRAFT_CONFLICT') showDraftConflict(error); throw error;
    }
    workingDraft = result.workingDraft; cloudLoaded = false;
    assets.forEach(asset => { if (documentText.includes(asset.url)) asset.uploaded = true; });
    await showEditor(result.path, result.text, result.path, result.sha, undefined, { session: backupSession, assets }, result.workingDraft);
    backupSession.touched = true;
    if (await flushBackup(true)) backupSession.touched = false;
    const post = readPost(result.text);
    cache.set(result.sha, { text: result.text, post });
    clearTimeout(pollTimer); ++pollEpoch;
    pending = { path: result.path, sha: result.sha, commit: result.commit, action,
      title: post.metadata.title, sourcePage: entry.page, url: action === 'publish' ? articleURL(result.path, post.metadata) : null, started: Date.now() };
    savePending(); progressState = { stage: 'queued' }; renderProgress(); setView('result');
    // The successful commit must remain successful even if refreshing the list fails.
    try { await refresh(); } catch { /* The list can be refreshed independently. */ }
  });
  if (pending) void checkProgress();
}
function updateViewport() {
  if (!embedded) { document.body.dataset.compact = String(innerWidth <= 800); if (dataEditor.records) dataEditor.updateSelection(); }
  const geometry = viewportGeometry(window.visualViewport, window.innerHeight);
  document.documentElement.style.setProperty('--editor-top', `${geometry.top}px`);
  const workspaceHeight = Math.ceil(document.querySelector('.workspace-header').getBoundingClientRect().height);
  document.documentElement.style.setProperty('--workspace-height', `${workspaceHeight}px`);
  const navHeight = Math.ceil(document.querySelector('.site-header').getBoundingClientRect().height);
  document.documentElement.style.setProperty('--nav-height', `${navHeight}px`);
  document.documentElement.style.setProperty('--editor-height', `${Math.max(1, geometry.height - navHeight - workspaceHeight)}px`);
  document.body.dataset.keyboard = String(geometry.height < window.innerHeight * .8 && (window.visualViewport?.scale || 1) < 1.2);
}

$('locale').addEventListener('click', () => {
  locale = locale === 'zh' ? 'en' : 'zh';
  try { localStorage.setItem(localeKey, locale); } catch { /* The selected language still applies to this page. */ }
  for (const id of ['search', 'filter-category', 'filter-tag', 'filter-year']) $(id).value = '';
  renderLocale();
  if (api && view === 'library') void hydrate(api);
});
$('editor-home').href = returnPage;
$('home-export').addEventListener('click', () => homeEditor.export());
$('home-reload').addEventListener('click', () => { if (confirm(homeEditor.text('reload'))) void run(async () => { await homeEditor.open('home', true); previewHome(); }); });
$('home-publish').addEventListener('click', () => void run(async () => { publishing = true; await homeEditor.publish(); }));
$('data-export').addEventListener('click', () => dataEditor.export());
$('data-reload').addEventListener('click', () => dataEditor.reset());
$('data-publish').addEventListener('click', () => void run(async () => { publishing = true; await dataEditor.publish(); }));
for (const id of ['search', 'filter-state', 'filter-category', 'filter-tag', 'filter-year']) $(id).addEventListener(id === 'search' ? 'input' : 'change', renderCards);
async function connected() {
  try { await backups.migrate(); } catch { /* Retain existing device backups. */ }
  restorePending();
  if (entry.kind === 'home') {
    await homeEditor.open('home'); setView('home', false);
  } else if (entry.kind === 'cv' || entry.kind === 'publications') {
    await dataEditor.open(entry.kind); section = entry.kind; setView('data', false);
  } else if (entry.path) {
    await loadCloud();
    const file = libraryFiles().find(file => file.path === entry.path);
    if (!file) throw new Error(t('noArticles'));
    const cloud = cloudDrafts.get(file.path);
    const record = file.cloudOnly ? { text: cloud.text } : await readArticle(api, file);
    cache.set(file.sha, record);
    await showEditor(cloud?.path || file.path, cloud?.text || record.text, cloud ? cloud.originalPath : file.path, cloud ? cloud.originalSha : file.sha, undefined, undefined, cloud);
  } else setView('library', false);
  tellParent({ type: 'editor-ready' });
  if (pending && !terminalStages.has(progressState.stage)) void checkProgress(true);
}
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
    changed(); $('block-editor').querySelector('button')?.focus();
  } catch (error) { notice(`${t('error')}${error.message}`, true); }
});
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => selectTab(button.dataset.tab));
$('source').addEventListener('input', () => {
  try { documentText = updatePost(documentText, {}, replaceArticleSection(readPost(documentText).body, 'body', $('source').value, locale)); changed(); updateImageTray(); }
  catch (error) { notice(`${t('error')}${error.message}`, true); }
});
for (const id of ['title', 'date', 'tags', 'categories']) $(id).addEventListener('input', () => {
  try {
    syncInformation();
    changed(); renderWorkspace();
  } catch (error) { notice(`${t('error')}${error.message}`, true); }
});
$('path').addEventListener('input', changed);
$('back').addEventListener('click', async () => { await flushBackup(true); setView('library'); });
$('editor-backups').addEventListener('click', showBackups);
$('backups-refresh').addEventListener('click', showBackups);
$('backups-back').addEventListener('click', () => setView(backupsReturn));
function syncPreviewTheme() {
  const root = $('preview-frame').contentDocument?.documentElement;
  if (root) root.dataset.theme = document.documentElement.dataset.theme;
}
window.addEventListener('editor-theme-change', syncPreviewTheme);
$('preview-frame').addEventListener('load', syncPreviewTheme);
$('insert-image').addEventListener('click', () => {
  imageSelection = { start: $('source').value.length, end: $('source').value.length }; $('image-input').click();
});
$('image-input').addEventListener('change', chooseImages);
async function saveWorking(all = false) {
  await run(async () => {
    if (!await flushBackup(true)) throw new Error(t('backupFailed'));
    const before = workingDraft?.text || baseline.text, selected = all ? null : draftScopes(before, documentText, tab);
    const selection = all ? null : tab === 'body' ? blockEditor.selected : tab === 'references' ? selectedReference : null;
    const outgoing = scopedDocument(before, documentText, tab, selection, blockEditor.renderer);
    const path = all || tab === 'file' ? $('path').value.trim() : baseline.path;
    const images = await Promise.all(activeAssets().filter(asset => !asset.uploaded).map(encodedImage));
    try {
      const result = await saveDraft(api, { path, originalPath, originalSha, baseText: workingDraft?.baseText || baseline.text, text: outgoing, expected: workingDraft, selected, images });
      const retained = retainArticle(before, documentText, result.text, selected);
      if (selection !== null && ['body', 'references'].includes(tab)) {
        const part = retainScopedSection(before, documentText, outgoing, result.text, tab);
        retained.working = updatePost(retained.working, {}, replaceArticleSection(readPost(retained.working).body, tab, part.working));
        retained.baseline = updatePost(retained.baseline, {}, replaceArticleSection(readPost(retained.baseline).body, tab, part.baseline));
      }
      originalPath = result.originalPath; originalSha = result.originalSha;
      workingDraft = { ...result, text: retained.baseline }; baseline = { text: result.text, path: result.path, state: savedState }; documentText = retained.working;
      dirty = documentText !== result.text || $('path').value !== result.path;
      assets.forEach(asset => { if (documentText.includes(asset.url)) asset.uploaded = true; });
      cloudDrafts.set(result.originalPath || result.path, result); fillFields(); schedulePreview(); updateImageTray();
      backupSession.touched = true; await flushBackup(true); backupSession.touched = dirty;
      $('backup-status').textContent = word('Saved to GitHub · unpublished', '已保存到 GitHub · 尚未发布');
      notice();
    } catch (error) {
      if (error.code === 'DRAFT_CONFLICT') showDraftConflict(error);
      throw error;
    }
  });
}
function showDraftConflict(error) {
  const root = $('draft-conflict'); root.replaceChildren(); root.hidden = false;
  const message = document.createElement('p'); message.textContent = word('This part changed on another device. Your edits are backed up locally.', '此部分已在另一设备修改，本机编辑已保留。'); root.append(message);
  for (const [label, value] of [[word('Your version', '本机版本'), error.mine], [word('Cloud version', '云端版本'), error.theirs]]) { const title = document.createElement('h3'); title.textContent = label; const text = document.createElement('pre'); text.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); root.append(title, text); }
  const use = document.createElement('button'); use.type = 'button'; use.textContent = word('Load cloud version', '加载云端版本');
  use.addEventListener('click', () => void run(async () => {
    if (!confirm(t('articleResetConfirm')) || !await flushBackup(true)) return;
    const snapshot = await api.snapshot(), file = snapshot.files.find(file => file.path === workingDraft?.storagePath);
    if (!file && !workingDraft) {
      const source = snapshot.files.find(file => file.path === originalPath);
      if (!source) throw new Error(word('Reopen this article to load the latest draft.', '请重新打开文章以加载最新草稿。'));
      const latest = await api.read(source.sha);
      documentText = mergeArticle(documentText, error.remoteText || latest, documentText, [error.key]); originalSha = source.sha; baseline.text = latest; fillFields(); changed(); root.hidden = true; return;
    }
    if (!file) throw new Error(word('Reopen this article to load the latest draft.', '请重新打开文章以加载最新草稿。'));
    const cloud = await readDraft(api, file);
    const target = error.remoteText || cloud.text;
    documentText = mergeArticle(documentText, target, documentText, [error.key]); workingDraft = { ...cloud, text: target }; baseline.text = target; fillFields(); changed(); root.hidden = true;
  })); root.append(use);
}
$('article-save').addEventListener('click', () => void saveWorking(false));
$('reset-whole').addEventListener('click', async () => {
  if (!baseline || !confirm(word('Reset the whole article to the last cloud save?', '将整篇文章重置为上次云端保存的内容？'))) return;
  documentText = baseline.text; $('path').value = baseline.path; dirty = false; fillFields(); schedulePreview();
  resetImageURLs(); assets = assets.filter(asset => documentText.includes(asset.url)); updateImageTray(); backupSession.touched = true; await flushBackup(true); backupSession.touched = false;
});
$('save-whole').addEventListener('click', () => void saveWorking(true));
$('publish-article').addEventListener('click', () => void save('publish'));
$('unpublish-article').addEventListener('click', () => void save('draft', true));
$('cloud-history').addEventListener('click', () => {
  const root = $('cloud-revisions'); root.replaceChildren();
  for (const revision of [...(workingDraft?.history || [])].reverse()) {
    const row = document.createElement('div'), date = document.createElement('time'), restore = document.createElement('button'); date.textContent = new Date(revision.date).toLocaleString(locale); restore.type = 'button'; restore.textContent = word('Restore', '恢复');
    restore.addEventListener('click', async () => { if (!confirm(t('restoreConfirm'))) return; await flushBackup(true); documentText = revision.text; fillFields(); changed(); await flushBackup(true); notice(word('Restored locally. Save to sync, then publish when ready.', '已在本机恢复，保存后同步，确认后再发布。')); });
    const preview = document.createElement('details'), label = document.createElement('summary'), text = document.createElement('pre'); label.textContent = word('Compare version', '查看版本'); text.textContent = revision.text; preview.append(label, text); row.append(date, restore, preview); root.append(row);
  }
  if (!root.childElementCount) root.textContent = word('No earlier cloud versions.', '暂无更早的云端版本。');
});
$('article-reset').addEventListener('click', async () => {
  if (!baseline || !confirm(t('articleResetConfirm'))) return;
  const keys = draftScopes(baseline.text, documentText, tab);
  const selection = tab === 'body' ? blockEditor.selected : tab === 'references' ? selectedReference : null;
  const reset = scopedDocument(documentText, baseline.text, tab, selection, blockEditor.renderer);
  documentText = mergeArticle(documentText, reset, documentText, keys);
  if (tab === 'file') $('path').value = baseline.path;
  dirty = documentText !== baseline.text || $('path').value !== baseline.path;
  resetImageURLs(); assets = assets.filter(asset => documentText.includes(asset.url));
  fillFields(); updateImageTray(); schedulePreview();
  backupSession.touched = true; backupSession.suppressed = false; await flushBackup(true); backupSession.touched = dirty;
});
$('article-preview-toggle').addEventListener('click', () => {
  const show = document.body.dataset.preview !== 'true'; document.body.dataset.preview = String(show);
  $('article-preview-toggle').setAttribute('aria-pressed', String(show)); if (show) void updatePreview();
});
$('publication-state').addEventListener('change', () => {
  try { documentText = updatePost(documentText, { draft: $('publication-state').value === 'draft' }); changed(); }
  catch (error) { notice(`${t('error')}${error.message}`, true); }
});
for (const name of ['abstract']) $(`${name}-source`).addEventListener('input', () => {
  try { documentText = updatePost(documentText, {}, replaceArticleSection(readPost(documentText).body, name, $(`${name}-source`).value, locale)); changed(); }
  catch (error) { notice(`${t('error')}${error.message}`, true); }
});
$('check-status').addEventListener('click', () => checkProgress(true));
$('continue-editing').addEventListener('click', () => { if (pending?.kind) { if (pending.kind === 'home') void openHome(); else void openSection(pending.kind); return; } if (documentText) setView('editor'); else void showBackups(); });
$('result-back').addEventListener('click', () => { if (embedded) tellParent({ type: 'editor-close' }); else void openSection('blog'); });
$('export').addEventListener('click', () => {
  download(new Blob([documentText], { type: 'text/markdown;charset=utf-8' }), $('path').value.split('/').at(-1) || 'article.md');
});
window.addEventListener('popstate', event => {
  const next = event.state?.editorView;
  if (next === 'data' && ['cv', 'publications'].includes(event.state?.section)) { void openSection(event.state.section, false); return; }
  if (next === 'home') { void openHome(false); return; }
  if (['login', 'library', 'editor', 'new', 'result', 'backups', 'data'].includes(next)) setView(api && next === 'login' ? 'home' : next, false);
});
window.addEventListener('beforeunload', event => { if (publishing || !safeToLeave && (dirty || dataEditor.dirty || homeEditor.dirty)) { event.preventDefault(); event.returnValue = ''; } });
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
const workspaceObserver = new ResizeObserver(updateViewport);
workspaceObserver.observe(document.querySelector('.site-header')); workspaceObserver.observe(document.querySelector('.workspace-header'));
for (const button of document.querySelectorAll('[data-block-add]')) button.addEventListener('click', () => { button.closest('details').open = false; if (button.dataset.blockAdd === 'image') $('image-input').click(); else blockEditor.add(button.dataset.blockAdd); });
$('focus-writing').addEventListener('click', () => { const focus = document.body.dataset.focus !== 'true'; document.body.dataset.focus = String(focus); $('focus-writing').setAttribute('aria-pressed', String(focus)); tellParent({ type: 'editor-focus', enabled: focus }); });
window.addEventListener('online', () => { if (dirty) notice(word('Online again. Save to sync your changes.', '网络已恢复，可保存并同步修改。')); });
window.addEventListener('offline', () => notice(word('Offline · changes stay on this device until you save online.', '当前离线，修改保存在本机，联网后请保存同步。')));
renderLocale(); setView('login', false);
async function initializeLogin() {
  await run(async () => {
    const config = await authConfiguration();
    if (config.mode === 'token') {
      if (!config.loginURL) throw new Error(t('githubNotReady'));
      location.replace(new URL(`${returnPage}?mode=edit`, config.loginURL).href); return;
    }
    if (!config.ready) { notice(t('githubNotReady'), true); return; }
    $('github-login-panel').hidden = false;
    $('github-login').href = `/admin/auth/login?${new URLSearchParams({ return: returnPage })}`;
    const errorCode = new URL(location.href).searchParams.get('auth_error');
    if (errorCode) {
      const clean = new URL(location.href); clean.searchParams.delete('auth_error'); history.replaceState(null, '', clean.href);
      const key = { invalid_state: 'loginStateError', cancelled: 'loginCancelled', account_not_allowed: 'accountNotAllowed', installation_required: 'installationRequired' }[errorCode] || 'loginUnavailable';
      notice(t(key), true); return;
    }
    let session;
    try { session = await authRequest('session'); }
    catch (error) { if (error.status === 401) { tellParent({ type: 'editor-login' }); return; } throw error; }
    if (!embedded) { location.replace(`${returnPage}?mode=edit`); return; }
    api = new SessionGitHub(session, t('sessionExpired')); api.readCache = new RepositoryCache();
    try { listing = true; await refresh(); await connected(); }
    catch (error) { api = null; throw error; }
  });
  $('login-retry').hidden = view !== 'login';
}
window.addEventListener('message', async event => {
  if (!embedded || event.origin !== location.origin || event.source !== window.parent) return;
  if (event.data?.type === 'site-appearance') {
    document.body.dataset.compact = String(event.data.compact === true);
    $('article-preview-toggle').hidden = view !== 'editor' || event.data.compact !== true;
    if (dataEditor.records) dataEditor.updateSelection();
    if (['dark', 'light'].includes(event.data.theme)) {
      document.documentElement.dataset.theme = event.data.theme;
      syncPreviewTheme();
    }
    previewHome();
  }
  if (event.data?.type === 'site-flush') {
    const saved = await flushBackup(true) && dataEditor.backup() && homeEditor.backup();
    safeToLeave = saved && !publishing;
    tellParent({ type: 'editor-flushed', id: event.data.id, ok: safeToLeave });
  }
});
$('login-retry').addEventListener('click', initializeLogin);
void initializeLogin();
