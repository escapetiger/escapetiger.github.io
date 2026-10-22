// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
import { readPost, updatePost } from './core.mjs?v=29';
import { articleSections, replaceArticleSection } from './article-sections.mjs?v=29';
import { splitBlocks } from './blocks.mjs?v=29';
import { referenceRows, serializeReferences } from './references.mjs?v=29';
import { mergeText } from './text-merge.mjs?v=29';
export function scopedDocument(base, mine, tab, selection, renderer) {
  if (selection === null || selection === undefined || !['body', 'references'].includes(tab)) return mine;
  const before = articleSections(readPost(base).body)[tab], local = articleSections(readPost(mine).body)[tab];
  let candidate = before;
  if (tab === 'body') {
    const original = splitBlocks(before, renderer), current = splitBlocks(local, renderer), old = original[selection], desired = current[selection];
    if (original.length !== current.length && selection < Math.min(original.length, current.length)) throw new Error('Save the whole article after restructuring blocks.');
    if (old && desired) candidate = before.slice(0, old.start) + desired.text + before.slice(old.end);
    else if (old) candidate = before.slice(0, old.start) + before.slice(old.end);
    else if (desired) candidate = before + (before.endsWith('\n\n') ? '' : '\n\n') + desired.text;
  } else {
    const original = referenceRows(before), current = referenceRows(local), label = row => row.text.match(/^\s*\[(\d+)\]/)?.[1];
    const originals = original.rows.filter(row => label(row) === selection), desireds = current.rows.filter(row => label(row) === selection);
    if (originals.length > 1 || desireds.length > 1) throw new Error('Reference numbers must be unique before saving one citation.');
    if (originals.length && desireds.length) originals[0].text = desireds[0].text;
    else if (originals.length) original.rows = original.rows.filter(row => label(row) !== selection);
    else if (desireds.length) { if (original.rows.length && !original.rows.at(-1).trailing.endsWith('\n\n')) original.rows.at(-1).trailing += '\n\n'; original.rows.push(desireds[0]); original.prefix ||= current.prefix; }
    candidate = serializeReferences(original);
  }
  return updatePost(mine, {}, replaceArticleSection(readPost(mine).body, tab, candidate));
}
export function retainScopedSection(base, mine, saved, remote, tab) {
  const section = text => articleSections(readPost(text).body)[tab], pending = section(mine), candidate = section(saved), latest = section(remote);
  const combined = mergeText(candidate, pending, latest);
  return { working: combined ?? pending, baseline: combined === null ? candidate : latest };
}
