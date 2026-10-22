// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
import { mergeText } from './text-merge.mjs?v=29';
import { readPost, updatePost, postPath } from './core.mjs?v=29';
import { articleSections, replaceArticleSection } from './article-sections.mjs?v=29';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export async function draftPath(path) {
  postPath(path);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
  return `.editor/drafts/${path.split('/')[2]}/${Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('')}.json`;
}
export function units(text) {
  const post = readPost(text), parts = articleSections(post.body);
  return { ...Object.fromEntries(Object.entries(post.metadata).map(([key, value]) => [`file:${key}`, value])), abstract: parts.abstract, body: parts.body, references: parts.references };
}
export function mergeArticle(base, mine, theirs, selected = null) {
  if (mine === base) return theirs;
  const before = units(base), local = units(mine), remote = units(theirs), keys = selected || [...new Set([...Object.keys(before), ...Object.keys(local)])];
  let result = theirs;
  for (const key of keys) {
    if (same(before[key], local[key])) continue;
    if (!key.startsWith('file:') && !same(remote[key], before[key]) && !same(remote[key], local[key])) {
      const merged = mergeText(before[key] || '', local[key] || '', remote[key] || '');
      if (merged !== null) { result = updatePost(result, {}, replaceArticleSection(readPost(result).body, key, merged)); continue; }
    }
    if (!same(remote[key], before[key]) && !same(remote[key], local[key])) {
      const error = new Error('This part changed on another device. Export your edits or load the cloud version.');
      Object.assign(error, { code: 'DRAFT_CONFLICT', key, before: before[key], mine: local[key], theirs: remote[key], remoteText: theirs }); throw error;
    }
    if (key.startsWith('file:')) result = updatePost(result, { [key.slice(5)]: local[key] });
    else result = updatePost(result, {}, replaceArticleSection(readPost(result).body, key, local[key] || ''));
  }
  return result;
}
export function draftScopes(base, mine, tab) {
  if (tab !== 'file') return [tab];
  return [...new Set([...Object.keys(units(base)), ...Object.keys(units(mine))])].filter(key => key.startsWith('file:'));
}
export function parseDraft(text) {
  const value = JSON.parse(text);
  if (value.version !== 1 || typeof value.text !== 'string' || typeof value.baseText !== 'string' || !Array.isArray(value.history)) throw new Error('Invalid cloud draft.');
  postPath(value.path); readPost(value.text); readPost(value.baseText);
  if (value.history.length > 20 || value.history.some(item => typeof item.text !== 'string' || typeof item.date !== 'string')) throw new Error('Invalid cloud history.');
  if (value.originalPath && value.originalPath.split('/')[2] !== value.path.split('/')[2]) throw new Error('Draft language mismatch.');
  if (value.originalPath) { postPath(value.originalPath); if (!/^[a-f0-9]{40}$/.test(value.originalSha)) throw new Error('Invalid source revision.'); }
  return value;
}
export async function readDraft(api, file) {
  const value = parseDraft(await api.read(file.sha));
  if (!new RegExp(`^\\.editor/drafts/${value.path.split('/')[2]}/[a-f0-9]{64}\\.json$`).test(file.path)) throw new Error('Invalid cloud draft path.');
  return { ...value, storagePath: file.path, sha: file.sha };
}
export async function commitFiles(api, snapshot, entries, message) {
  const tree = await api.request('git/trees', 'POST', { base_tree: snapshot.tree, tree: entries });
  const commit = await api.request('git/commits', 'POST', { tree: tree.sha, parents: [snapshot.head], message });
  await api.request(`git/refs/heads/${api.branch}`, 'PATCH', { sha: commit.sha, force: false });
  api.latestSnapshot = null; return commit.sha;
}
export async function saveDraft(api, { path, originalPath = null, originalSha = null, baseText, text, expected, selected, images = [], archived = false }) {
  const storagePath = expected?.storagePath || await draftPath(originalPath || path), snapshot = await api.snapshot();
  if (!new RegExp(`^\\.editor/drafts/${path.split('/')[2]}/[a-f0-9]{64}\\.json$`).test(storagePath) || originalPath && originalPath.split('/')[2] !== path.split('/')[2]) throw new Error('Keep the article in its original language.');
  const file = snapshot.files.find(file => file.path === storagePath);
  const current = file ? await readDraft(api, file) : null;
  if (expected && !current) throw new Error('The cloud draft was removed. Export your edits before reopening.');
  if (current && current.path !== (expected?.path || path)) throw new Error('The draft path changed on another device.');
  let sourceBase = current?.baseText || baseText, sourceSha = current?.originalSha ?? originalSha;
  const sourcePath = current?.originalPath ?? originalPath;
  let remote = current?.text || baseText;
  if (sourcePath) {
    const source = snapshot.files.find(file => file.path === sourcePath);
    if (!source || source.mode !== '100644') throw new Error('The live source was removed. Duplicate the working draft to restore it as a new article.');
    if (source.sha !== sourceSha) {
      const latest = await api.read(source.sha);
      for (let attempt = 0; attempt < Object.keys(units(latest)).length + 1; attempt++) {
        try { remote = mergeArticle(sourceBase, remote, latest); break; }
        catch (error) {
          if (error.code !== 'DRAFT_CONFLICT' || selected && !selected.includes(error.key) || !same(units(text)[error.key], units(latest)[error.key])) throw error;
          remote = mergeArticle(remote, latest, remote, [error.key]);
        }
      }
      sourceBase = latest; sourceSha = source.sha;
    }
  }
  const baseline = expected?.text || baseText;
  const merged = mergeArticle(baseline, text, remote, selected);
  const record = { version: 1, path, originalPath: sourcePath, originalSha: sourceSha,
    baseText: sourceBase, text: merged, archived, updated: new Date().toISOString(),
    history: [...(current?.history || []), ...(current && current.text !== merged ? [{ text: current.text, date: current.updated }] : [])].slice(-20) };
  let content = JSON.stringify(record);
  while (record.history.length && new TextEncoder().encode(content).length > 2 * 1024 * 1024) { record.history.shift(); content = JSON.stringify(record); }
  if (new TextEncoder().encode(content).length > 2 * 1024 * 1024 || images.length > 8 || new Set(images.map(image => image.path)).size !== images.length) throw new Error('Draft exceeds the storage limit. Export the article and reduce its size.');
  const blob = await api.request('git/blobs', 'POST', { content, encoding: 'utf-8' });
  const entries = [{ path: storagePath, mode: '100644', type: 'blob', sha: blob.sha }];
  for (const image of images) {
    if (!/^static\/images\/blog\/[a-z0-9-]{16,80}\.(jpg|png|webp)$/.test(image.path) || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.content) || image.content.length > 4 * 1024 * 1024) throw new Error('Invalid image.');
    const media = await api.request('git/blobs', 'POST', { content: image.content, encoding: 'base64' });
    const existing = snapshot.files.find(file => file.path === image.path);
    if (existing && existing.sha !== media.sha) throw new Error('Image collision.');
    if (!existing) entries.push({ path: image.path, mode: '100644', type: 'blob', sha: media.sha });
  }
  const commit = await commitFiles(api, snapshot, entries, `Save working draft: ${path}`);
  return { ...record, storagePath, sha: blob.sha, commit };
}
export async function deleteArticle(api, file, draft) {
  const snapshot = await api.snapshot(), current = snapshot.files.find(item => item.path === file.path);
  if (current?.sha !== file.sha) throw new Error('Article changed. Refresh before deleting.');
  const text = draft?.text || await api.read(file.sha), storagePath = draft?.storagePath || await draftPath(file.path);
  const currentDraft = snapshot.files.find(item => item.path === storagePath);
  if ((currentDraft?.sha || null) !== (draft?.sha || null)) throw new Error('Cloud draft changed. Refresh before deleting.');
  const record = { version: 1, path: file.path, originalPath: null, originalSha: null, baseText: text, text, archived: true, updated: new Date().toISOString(), history: draft?.history || [] };
  const blob = await api.request('git/blobs', 'POST', { content: JSON.stringify(record), encoding: 'utf-8' });
  const entries = [{ path: storagePath, mode: '100644', type: 'blob', sha: blob.sha }];
  if (current) entries.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
  return commitFiles(api, snapshot, entries, `Archive article: ${file.path}`);
}

export function retainArticle(base, local, remote, selected) {
  const before = units(base), mine = units(local), chosen = selected || Object.keys(mine);
  let working = remote, baseline = remote;
  for (const key of new Set([...Object.keys(before), ...Object.keys(mine)])) {
    if (chosen.includes(key) || same(before[key], mine[key])) continue;
    if (key.startsWith('file:')) { working = updatePost(working, { [key.slice(5)]: mine[key] }); baseline = updatePost(baseline, { [key.slice(5)]: before[key] }); }
    else { working = updatePost(working, {}, replaceArticleSection(readPost(working).body, key, mine[key] || '')); baseline = updatePost(baseline, {}, replaceArticleSection(readPost(baseline).body, key, before[key] || '')); }
  }
  return { working, baseline };
}
