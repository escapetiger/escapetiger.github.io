// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
// Retain the heading, whitespace and citation labels verbatim until explicitly edited.
export function referenceRows(source) {
  const heading = source.match(/^[^\n]*(?:\n|$)[\t \r\n]*/)?.[0] || '';
  const prefix = /^\s*#/.test(heading) ? heading : '';
  const content = source.slice(prefix.length), starts = [];
  let fence = null;
  for (const match of content.matchAll(/[^\n]+\n?|\n/g)) {
    const line = match[0].replace(/\r?\n$/, ''), marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
    } else if (!fence && /^ {0,3}\[\d+\]\s/.test(line) && (match.index === 0 || /\n\s*\n$/.test(content.slice(0, match.index)))) starts.push(match.index);
  }
  if (!starts.length) {
    for (const match of content.matchAll(/\S[\s\S]*?(?=\r?\n[\t ]*\r?\n|$)/g)) starts.push(match.index);
  }
  if (content.trim() && starts[0] !== 0) starts.unshift(0);
  const rows = starts.map((start, index) => {
    const raw = content.slice(start, starts[index + 1] ?? content.length);
    const trailing = raw.match(/\s*$/)[0];
    return { text: raw.slice(0, raw.length - trailing.length), trailing };
  });
  return { prefix, rows, empty: rows.length ? '' : content };
}
export function serializeReferences(model) {
  return model.prefix + (model.rows.length ? model.rows.map(row => row.text + row.trailing).join('') : model.empty || '');
}
export function addReference(model, locale = 'en') {
  if (!model.prefix) model.prefix = `## ${locale === 'zh' ? '参考文献' : 'References'}\n\n`;
  const labels = model.rows.map(row => Number(row.text.match(/^\s*\[(\d+)\]/)?.[1] || 0));
  const previous = model.rows.at(-1);
  if (previous && !/\n\s*\n$/.test(previous.trailing)) previous.trailing += '\n\n';
  model.rows.push({ text: `[${Math.max(0, ...labels) + 1}] `, trailing: '\n' });
}
