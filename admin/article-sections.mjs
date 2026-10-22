// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
const referenceHeading = /^ {0,3}#{1,6}\s+(?:(?:\d+[.)]?)\s+)?(?:References?|Bibliography|参考文献|参考资料|参考文獻)\s*#*\s*$/i;

// Slice at explicit Markdown boundaries only; opening an editor never rewrites prose.
export function articleSections(source) {
  let fence = null, more = null, references = source.length;
  for (const match of source.matchAll(/[^\n]+\n?|\n/g)) {
    const line = match[0].replace(/\r?\n$/, ''), marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (fence) continue;
    if (!more && /^\s*<!--more-->\s*$/.test(line) && match.index < references) more = { start: match.index, end: match.index + match[0].length };
    if (references === source.length && referenceHeading.test(line)) references = match.index;
  }
  return {
    abstract: more ? source.slice(0, more.start) : '',
    separator: more ? source.slice(more.start, more.end) : '',
    body: source.slice(more?.end || 0, references),
    references: source.slice(references)
  };
}

export function replaceArticleSection(source, section, value, locale = 'en') {
  if (!['abstract', 'body', 'references'].includes(section)) throw new Error('Unknown article section.');
  const parts = articleSections(source);
  if (parts[section] === value) return source;
  parts[section] = value;
  if (section === 'abstract' && value && !parts.separator) parts.separator = '<!--more-->\n';
  if (parts.separator && parts.abstract && !parts.abstract.endsWith('\n')) parts.abstract += '\n';
  if (section === 'references' && value.trim() && !referenceHeading.test(value.split('\n')[0])) {
    parts.references = `## ${locale === 'zh' ? '参考文献' : 'References'}\n\n${value}`;
  }
  if (parts.references && parts.body && !parts.body.endsWith('\n')) parts.body += '\n\n';
  return parts.abstract + parts.separator + parts.body + parts.references;
}
