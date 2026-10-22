// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
function hunks(base, changed) {
  const a = base.split(/(?<=\n)/), b = changed.split(/(?<=\n)/);
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a.at(-1 - suffix) === b.at(-1 - suffix)) suffix++;
  const x = a.slice(prefix, a.length - suffix), y = b.slice(prefix, b.length - suffix);
  if (x.length * y.length > 1000000) return [{ start: prefix, end: a.length - suffix, lines: y }];
  const table = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) table[i][j] = x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const edits = []; let i = 0, j = 0, edit;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { if (edit) edits.push(edit); edit = null; i++; j++; }
    else { edit ||= { start: prefix + i, end: prefix + i, lines: [] }; if (j < y.length && (i === x.length || table[i][j + 1] > table[i + 1][j])) edit.lines.push(y[j++]); else { i++; edit.end = prefix + i; } }
  }
  if (edit) edits.push(edit); return edits;
}
export function mergeText(base, mine, theirs) {
  if (mine === base || mine === theirs) return theirs;
  if (theirs === base) return mine;
  const local = hunks(base, mine), remote = hunks(base, theirs), combined = [...remote];
  for (const edit of local) {
    const overlaps = remote.filter(other => edit.start === other.start || edit.start < other.end && other.start < edit.end || edit.start === edit.end && edit.start > other.start && edit.start < other.end || other.start === other.end && other.start > edit.start && other.start < edit.end);
    if (overlaps.some(other => JSON.stringify(other) !== JSON.stringify(edit))) return null;
    if (!overlaps.length) combined.push(edit);
  }
  const lines = base.split(/(?<=\n)/);
  for (const edit of combined.sort((a, b) => b.start - a.start)) lines.splice(edit.start, edit.end - edit.start, ...edit.lines);
  return lines.join('');
}
