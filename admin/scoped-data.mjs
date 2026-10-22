// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
import { parseData, dataPath } from './data-editor.mjs?v=29';
export const cvSections = ['research', 'appointments', 'education', 'visiting', 'service', 'talks', 'posters', 'teaching'];
export const clone = value => value === undefined ? undefined : structuredClone(value);
const canonical = value => value === undefined ? 'undefined' : JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const equal = (a, b) => canonical(a) === canonical(b);
export const dump = value => globalThis.jsyaml.dump(value, { lineWidth: 100, noRefs: true, schema: globalThis.jsyaml.JSON_SCHEMA });
export const scopeKey = scope => canonical(scope);
export const groupKeys = value => [...cvSections.filter(key => value[key]), ...Object.keys(value.custom_sections || {}).map(key => `custom_sections.${key}`)];
export const groupAt = (value, key) => key?.startsWith('custom_sections.') ? value.custom_sections?.[key.slice(16)] : value[key];
export const setGroup = (value, key, section) => {
  const parent = key.startsWith('custom_sections.') ? (value.custom_sections ??= {}) : value;
  const name = key.startsWith('custom_sections.') ? key.slice(16) : key;
  if (section === undefined) delete parent[name]; else parent[name] = clone(section);
};
export const entriesAt = (kind, value, group) => kind === 'publications' ? value : groupAt(value, group)?.[group === 'research' ? 'items' : 'entries'];
const metadata = section => section && Object.fromEntries(Object.entries(section).filter(([key]) => !['items', 'entries'].includes(key)));
function legacyId(value, namespace) {
  // Legacy entries acquire the same identity on every device before their first save.
  const text = namespace + canonical(value); let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `legacy_${(a >>> 0).toString(36)}_${(b >>> 0).toString(36)}`;
}
export function normalizeData(kind, input, lang) {
  const value = clone(input), ids = new Set();
  for (const group of kind === 'publications' ? [''] : groupKeys(value)) {
    const list = entriesAt(kind, value, group);
    list.forEach((item, index) => {
      const entry = typeof item === 'string' ? { text: item } : item;
      entry._id ??= legacyId(entry, `${kind}/${lang}/${group}/`);
      if (typeof entry._id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(entry._id) || ids.has(entry._id)) {
        const error = new Error('Duplicate or invalid entry identity. Export the data and assign unique _id values before editing.'); error.code = 'identity'; throw error;
      }
      ids.add(entry._id); list[index] = entry;
    });
  }
  return value;
}
export function unitValue(kind, value, scope) {
  if (scope.type === 'field') return value[scope.key];
  if (scope.type === 'section') return metadata(groupAt(value, scope.group));
  return entriesAt(kind, value, scope.group)?.find(entry => entry._id === scope.id);
}
export function putUnit(kind, value, scope, next) {
  if (scope.type === 'field') { value[scope.key] = clone(next); return; }
  if (scope.type === 'section') {
    if (next === undefined) setGroup(value, scope.group, undefined);
    else {
      const old = groupAt(value, scope.group), listKey = scope.group === 'research' ? 'items' : 'entries';
      setGroup(value, scope.group, { ...clone(next), [listKey]: clone(old?.[listKey] || []) });
    }
    return;
  }
  const list = entriesAt(kind, value, scope.group);
  if (!list) { const error = new Error('The parent section was removed.'); error.code = 'parent'; throw error; }
  const index = list.findIndex(entry => entry._id === scope.id);
  if (next === undefined) { if (index >= 0) list.splice(index, 1); }
  else if (index >= 0) list[index] = clone(next); else list.push(clone(next));
}
function putOrdered(kind, target, scope, value, order) {
  const list = scope.type === 'entry' && entriesAt(kind, target, scope.group);
  if (!list || value === undefined || list.some(entry => entry._id === scope.id)) { putUnit(kind, target, scope, value); return; }
  const desired = entriesAt(kind, order, scope.group), index = desired.findIndex(entry => entry._id === scope.id);
  const following = desired.slice(index + 1).find(entry => list.some(item => item._id === entry._id));
  const preceding = desired.slice(0, index).reverse().find(entry => list.some(item => item._id === entry._id));
  const position = following ? list.findIndex(entry => entry._id === following._id) : preceding ? list.findIndex(entry => entry._id === preceding._id) + 1 : list.length;
  list.splice(position, 0, clone(value));
}
export function scopesFor(kind, value) {
  if (kind === 'publications') return value.map(entry => ({ type: 'entry', id: entry._id }));
  return [{ type: 'field', key: 'intro' }, { type: 'field', key: 'pdf' }, ...groupKeys(value).flatMap(group => [
    { type: 'section', group }, ...entriesAt(kind, value, group).map(entry => ({ type: 'entry', group, id: entry._id }))
  ])];
}
export function changes(kind, base, working) {
  const scopes = new Map([...scopesFor(kind, base), ...scopesFor(kind, working)].map(scope => [scopeKey(scope), scope]));
  return [...scopes.values()].filter(scope => {
    if (scope.type === 'entry' && kind === 'cv' && !groupAt(working, scope.group) && groupAt(base, scope.group)) return false;
    return !equal(unitValue(kind, base, scope), unitValue(kind, working, scope));
  });
}
function conflict(scope, before, mine, theirs) {
  const error = new Error('This item changed on GitHub. Your local edits have been kept.');
  Object.assign(error, { code: 'conflict', scope, before: clone(before), mine: clone(mine), theirs: clone(theirs) }); throw error;
}
export function mergeUnits(kind, base, working, remote, selected) {
  const merged = clone(remote);
  for (const scope of selected) {
    const before = unitValue(kind, base, scope), mine = unitValue(kind, working, scope), theirs = unitValue(kind, merged, scope);
    if (scope.type === 'section' && mine === undefined) {
      const oldSection = groupAt(base, scope.group), remoteSection = groupAt(merged, scope.group);
      if (remoteSection && !equal(oldSection, remoteSection)) conflict(scope, oldSection, undefined, remoteSection);
    } else if (!equal(theirs, before) && !equal(theirs, mine)) conflict(scope, before, mine, theirs);
    if (scope.type === 'entry' && kind === 'cv' && !groupAt(merged, scope.group)) {
      if (groupAt(base, scope.group)) conflict(scope, before, mine, undefined);
      putUnit(kind, merged, { type: 'section', group: scope.group }, metadata(groupAt(working, scope.group)));
    }
    putOrdered(kind, merged, scope, mine, working);
  }
  return merged;
}
export function retainPending(kind, base, working, saved, selected) {
  const done = new Set(selected.map(scopeKey)), nextBase = clone(saved), nextWorking = clone(saved);
  for (const scope of selected) if (kind === 'cv' && scope.type === 'entry' && !groupAt(base, scope.group) && groupAt(saved, scope.group)) done.add(scopeKey({ type: 'section', group: scope.group }));
  for (const scope of changes(kind, base, working).filter(scope => !done.has(scopeKey(scope)))) {
    if (scope.type === 'section' && !groupAt(working, scope.group)) {
      setGroup(nextBase, scope.group, groupAt(base, scope.group)); setGroup(nextWorking, scope.group, undefined); continue;
    }
    // Keep the old baseline for unsaved items so a remote change still conflicts later.
    if (kind === 'cv' && scope.type === 'entry') {
      if (!groupAt(nextBase, scope.group) && groupAt(base, scope.group)) setGroup(nextBase, scope.group, groupAt(base, scope.group));
      if (!groupAt(nextWorking, scope.group)) {
        const section = groupAt(working, scope.group);
        setGroup(nextWorking, scope.group, { ...metadata(section), [scope.group === 'research' ? 'items' : 'entries']: [] });
      }
    }
    if (!(kind === 'cv' && scope.type === 'entry' && !groupAt(nextBase, scope.group))) putUnit(kind, nextBase, scope, unitValue(kind, base, scope));
    putOrdered(kind, nextWorking, scope, unitValue(kind, working, scope), working);
  }
  return { base: nextBase, working: nextWorking };
}
export async function saveUnits(api, kind, lang, base, working, selected) {
  if (!selected.length) return null;
  const path = dataPath(kind, lang), state = await api.snapshot(), file = state.files.find(file => file.path === path && file.mode === '100644');
  if (!file) throw new Error(`Missing ${path}`);
  const remote = normalizeData(kind, parseData(kind, await api.read(file.sha)), lang);
  const value = mergeUnits(kind, base, working, remote, selected), text = dump(value);
  try { parseData(kind, text); } catch (error) { error.code = 'invalid'; throw error; }
  if (equal(remote, value)) return { value, text, files: [file], commit: null };
  const blob = await api.request('git/blobs', 'POST', { content: text, encoding: 'utf-8' });
  const entry = { path, sha: blob.sha, mode: '100644', type: 'blob' };
  const tree = await api.request('git/trees', 'POST', { base_tree: state.tree, tree: [entry] });
  const commit = await api.request('git/commits', 'POST', { message: `Update ${selected.length === 1 ? selected[0].type : 'items'} in ${kind} (${lang})`, tree: tree.sha, parents: [state.head] });
  await api.request('git/refs/heads/main', 'PATCH', { sha: commit.sha, force: false });
  api.latestSnapshot = null;
  return { value, text, files: [entry], commit: commit.sha };
}

// Upgrade old device drafts only when entry correspondence can be proved.
export function recoverLegacy(kind, original, edited, lang) {
  const base = normalizeData(kind, original, lang), working = clone(edited);
  for (const group of kind === 'publications' ? [''] : groupKeys(working)) {
    const before = entriesAt(kind, base, group) || [], list = entriesAt(kind, working, group), remaining = new Set(before.map(entry => entry._id));
    const content = entry => { const value = typeof entry === 'string' ? { text: entry } : clone(entry); delete value._id; return value; };
    const unknown = [];
    list.forEach((entry, index) => {
      const value = typeof entry === 'string' ? { text: entry } : entry;
      const match = before.find(item => remaining.has(item._id) && (value._id === item._id || equal(content(item), content(value))));
      if (match) { value._id = match._id; remaining.delete(match._id); } else unknown.push(index);
      list[index] = value;
    });
    if (unknown.length === 1 && remaining.size === 1) list[unknown[0]]._id = [...remaining][0];
    else if (!remaining.size) for (const index of unknown) list[index]._id ??= `item_${crypto.randomUUID().replaceAll('-', '')}`;
    else if (unknown.length) { const error = new Error('Older edits cannot be matched safely.'); error.code = 'legacy'; throw error; }
  }
  return { base, value: normalizeData(kind, working, lang) };
}
