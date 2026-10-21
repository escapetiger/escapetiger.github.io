// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
import { GitHub, newPost, postPath } from './core.mjs';

const messages = {
  zh: {
    heading: '博客编辑', intro: '在手机上编写 Markdown，通过 GitHub 保存与发布。',
    token: 'GitHub 专用访问令牌', tokenHelp: '仅选择 hugo-yicai 仓库，授予 Contents 读写权限。令牌仅留在当前页面内存中，刷新后需重新输入。',
    connect: '连接 GitHub', createToken: '创建令牌', new: '新建文章', refresh: '刷新列表', restore: '恢复本机备份', logout: '断开连接',
    search: '搜索文件路径', articles: '选择文章', choose: '请选择文章…', title: '文章标题', language: '文章语言', slug: '主题 / 文件名（例如 math/my-note）',
    create: '开始编写', path: '保存路径', source: 'Markdown 原文（含 YAML 文章信息）',
    sourceHelp: '保留开头的 --- 信息区。可修改标题、日期、标签与分类，正文支持现有数学公式写法。',
    saveDraft: '存为草稿', publish: '发布文章', export: '导出 .md',
    draftHelp: '“存为草稿”会移入 drafts/，已发布文章将下线。“发布文章”会移出 drafts/ 并设为公开。上线需要等待自动构建成功；未来日期仍遵循 Hugo 的定时规则。',
    commit: '查看此次提交', builds: '查看自动发布状态', working: '正在处理，请稍候…', connected: '已连接 GitHub。',
    loaded: '已加载文章。', saved: '已提交到 GitHub，网站更新需等待自动发布成功。',
    backup: '已备份到本机。', backupFailed: '本机备份不可用，请及时导出 Markdown。', noBackup: '没有可恢复的本机备份。',
    restored: '已恢复本机备份。提交时会检查 GitHub 上的版本。', disconnected: '已断开连接，令牌已清除。',
    discard: '有未提交的修改。是否离开当前文章？请先导出以保留这些修改。',
    publishConfirm: '确认将这篇文章发布到公开网站？', draftConfirm: '确认存为草稿？如果文章已上线，此操作会将它下线。',
    expired: '备份格式无效，请使用导出的 Markdown。', unknownSave: '提交失败或网络中断。请先导出当前内容；如果 GitHub 已收到提交，重新打开文章核对后再操作。',
    error: '操作失败：', englishError: '以下为具体错误信息：', newReady: '新文章已创建在编辑器中，尚未提交。'
  },
  en: {
    heading: 'Blog Editor', intro: 'Write Markdown on your phone. Save and publish through GitHub.',
    token: 'GitHub personal access token', tokenHelp: 'Select only hugo-yicai, with Contents: read and write. The token stays in page memory; enter it again after reloading.',
    connect: 'Connect GitHub', createToken: 'Create a token', new: 'New article', refresh: 'Refresh list', restore: 'Restore local backup', logout: 'Disconnect',
    search: 'Search file paths', articles: 'Choose an article', choose: 'Choose an article…', title: 'Article title', language: 'Article language', slug: 'Topic / filename (e.g. math/my-note)',
    create: 'Start writing', path: 'Save path', source: 'Markdown source, including YAML front matter',
    sourceHelp: 'Keep the opening --- metadata block. Edit the title, date, tags and categories here. Existing math syntax is supported.',
    saveDraft: 'Save draft', publish: 'Publish', export: 'Export .md',
    draftHelp: 'Save draft moves the article into drafts/ and removes a published article from the site. Publish moves it out and makes it public after a successful build. Future dates still follow Hugo scheduling rules.',
    commit: 'View this commit', builds: 'View deployment status', working: 'Working…', connected: 'Connected to GitHub.',
    loaded: 'Article loaded.', saved: 'Committed to GitHub. The website updates after automatic deployment succeeds.',
    backup: 'Backed up on this device.', backupFailed: 'Local backup is unavailable. Export your Markdown to keep a copy.', noBackup: 'No local backup to restore.',
    restored: 'Local backup restored. Saving checks the version on GitHub.', disconnected: 'Disconnected. Token cleared.',
    discard: 'There are uncommitted edits. Leave this article? Export first to keep these edits.',
    publishConfirm: 'Publish this article to the public website?', draftConfirm: 'Save as a draft? This takes an already published article offline.',
    expired: 'Invalid backup format. Use an exported Markdown file.', unknownSave: 'The save failed or the network was interrupted. Export your edits first; if GitHub received the commit, reopen the article and check before retrying.',
    error: 'Operation failed: ', englishError: 'Details:', newReady: 'New article created in the editor. Not yet committed.'
  }
};
const $ = id => document.getElementById(id);
const backupKey = 'yicai-blog-editor-backup-v1';
let locale = navigator.language.startsWith('zh') ? 'zh' : 'en';
let api, files = [], originalPath = null, originalSha = null, dirty = false, busy = false;
const t = key => messages[locale][key];
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function renderLocale() {
  document.documentElement.lang = locale;
  $('locale').value = locale;
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
  renderFiles();
}
function renderFiles() {
  const selected = $('articles').value;
  const term = $('search').value.toLowerCase();
  $('articles').replaceChildren(new Option(t('choose'), ''));
  for (const file of files.filter(file => file.path.toLowerCase().includes(term))) {
    $('articles').add(new Option(file.path.replace('content/blog/', ''), file.path));
  }
  $('articles').value = selected;
}
async function run(task) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button, input, select, textarea').forEach(node => { node.disabled = true; });
  status(t('working'));
  try { await task(); } catch (error) { status(`${t('error')}${error.message}`, true); }
  finally {
    busy = false;
    document.querySelectorAll('button, input, select, textarea').forEach(node => { node.disabled = false; });
  }
}
function mayLeave() { return !dirty || confirm(t('discard')); }
function backup() {
  try {
    localStorage.setItem(backupKey, JSON.stringify({ path: $('path').value, text: $('source').value, originalPath, originalSha }));
    $('backup-status').textContent = t('backup');
  } catch { $('backup-status').textContent = t('backupFailed'); }
}
function showEditor(path, text, loadedPath, sha) {
  $('path').value = path;
  $('source').value = text;
  originalPath = loadedPath;
  originalSha = sha;
  $('new-form').hidden = true;
  $('editor').hidden = false;
  $('commit-link').hidden = true;
  $('backup-status').textContent = '';
  dirty = false;
}
async function refresh() {
  const snapshot = await api.snapshot();
  files = snapshot.files.filter(file => {
    try { postPath(file.path); return file.type === 'blob' && file.mode === '100644'; }
    catch { return false; }
  }).sort((a, b) => a.path.localeCompare(b.path));
  renderFiles();
}
$('locale').addEventListener('change', () => { locale = $('locale').value; renderLocale(); });
$('search').addEventListener('input', renderFiles);
$('login-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const candidate = new GitHub($('token').value.trim());
    $('token').value = '';
    api = candidate;
    try { await refresh(); } catch (error) { api.token = ''; api = null; throw error; }
    $('login').hidden = true;
    $('workspace').hidden = false;
    status(t('connected'));
  });
});
$('refresh').addEventListener('click', () => run(async () => { await refresh(); status(t('connected')); }));
$('articles').addEventListener('change', () => {
  const file = files.find(file => file.path === $('articles').value);
  if (!file || !mayLeave()) { $('articles').value = originalPath || ''; return; }
  run(async () => {
    const text = await api.read(file.sha);
    showEditor(file.path, text, file.path, file.sha);
    status(t('loaded'));
  });
});
$('new').addEventListener('click', () => {
  if (!mayLeave()) return;
  $('new-form').hidden = false;
  $('title').focus();
});
$('new-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!mayLeave()) return;
  try {
    const slug = $('slug').value.trim().replace(/\.md$/, '');
    if (!slug || slug.endsWith('/') || slug.split('/')[0] === 'drafts') throw new Error('Use a topic/filename without a drafts/ prefix.');
    const path = postPath(`content/blog/${$('language').value}/drafts/${slug}.md`);
    showEditor(path, newPost($('title').value), null, null);
    dirty = true;
    backup();
    status(t('newReady'));
    $('source').focus();
  } catch (error) { status(`${t('error')}${error.message}`, true); }
});
for (const id of ['path', 'source']) $(id).addEventListener('input', () => { dirty = true; backup(); });
$('restore').addEventListener('click', () => {
  if (!mayLeave()) return;
  try {
    const raw = localStorage.getItem(backupKey);
    if (!raw) { status(t('noBackup')); return; }
    const data = JSON.parse(raw);
    postPath(data.path);
    if (typeof data.text !== 'string' || (data.originalPath !== null && typeof data.originalPath !== 'string') ||
        (data.originalSha !== null && !/^[0-9a-f]{40}$/.test(data.originalSha))) throw new Error(t('expired'));
    if (data.originalPath) postPath(data.originalPath);
    showEditor(data.path, data.text, data.originalPath, data.originalSha);
    dirty = true;
    status(t('restored'));
  } catch (error) { status(`${t('error')}${error.message}`, true); }
});
async function save(action) {
  if (!confirm(t(action === 'publish' ? 'publishConfirm' : 'draftConfirm'))) return;
  await run(async () => {
    let result;
    try {
      result = await api.save({ originalPath, originalSha, path: $('path').value.trim(), text: $('source').value, action });
    } catch (error) {
      backup();
      throw new Error(`${error.message}\n${t('unknownSave')}`);
    }
    showEditor(result.path, result.text, result.path, result.sha);
    backup();
    $('commit-link').href = `https://github.com/escapetiger/hugo-yicai/commit/${result.commit}`;
    $('commit-link').hidden = false;
    status(t('saved'));
    // A list refresh failure must not turn a successful commit into an apparent save failure.
    try { await refresh(); $('articles').value = result.path; }
    catch (error) { status(`${t('saved')}\n${error.message}`); }
  });
}
$('save-draft').addEventListener('click', () => save('draft'));
$('publish').addEventListener('click', () => save('publish'));
$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([$('source').value], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = $('path').value.split('/').at(-1) || 'article.md';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
});
$('logout').addEventListener('click', () => {
  if (!mayLeave()) return;
  if (api) api.token = '';
  api = null;
  files = [];
  $('source').value = '';
  $('path').value = '';
  $('editor').hidden = true;
  $('new-form').hidden = true;
  $('workspace').hidden = true;
  $('login').hidden = false;
  dirty = false;
  status(t('disconnected'));
});
window.addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
renderLocale();
