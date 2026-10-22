// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
import { articleState } from './core.mjs?v=29';
export const localeKey = 'yicai-editor-locale-v1';
export function preferredLocale(language, storage = () => globalThis.localStorage) {
  try { const saved = storage().getItem(localeKey); if (['zh', 'en'].includes(saved)) return saved; } catch { /* Use the browser language when storage is unavailable. */ }
  return language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
export const articleLanguage = path => path?.split('/')[2];
export function taxonomyTerms(value) {
  return [...new Set((Array.isArray(value) ? value : [value]).filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))];
}
export function articleDate(metadata = {}, locale = 'en') {
  const raw = metadata.date || metadata.publishDate;
  if (typeof raw !== 'string') return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number), dayValue = new Date(Date.UTC(year, month - 1, day));
  if (dayValue.getUTCFullYear() !== year || dayValue.getUTCMonth() !== month - 1 || dayValue.getUTCDate() !== day) return null;
  return { iso: raw.slice(0, 10), year: String(year), timestamp: Number.isNaN(Date.parse(raw)) ? dayValue.getTime() : Date.parse(raw),
    label: locale === 'zh' ? `${year}年${month}月${day}日` : new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(dayValue) };
}
export function articleSummary(post) {
  const metadata = post?.metadata || {};
  const source = typeof metadata.description === 'string' ? metadata.description : typeof metadata.summary === 'string' ? metadata.summary : post?.body || '';
  const plain = source.split('<!--more-->')[0].replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>|\{\{[<%][\s\S]*?[%>]\}\}/g, ' ').replace(/(^|\n)\s*[#>*-]+\s*/g, '$1')
    .replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
  const characters = Array.from(plain);
  return characters.length > 160 ? characters.slice(0, 160).join('') + '…' : plain;
}
export function selectArticles(files, cache, { language, term = '', state = '', category = '', tag = '', year = '', now = Date.now() }) {
  const query = term.trim().toLocaleLowerCase();
  return files.filter(file => {
    if (articleLanguage(file.path) !== language) return false;
    const metadata = cache.get(file.sha)?.post?.metadata || {};
    const categories = taxonomyTerms(metadata.categories), tags = taxonomyTerms(metadata.tags), date = articleDate(metadata, language);
    return (!state || articleState(file.path, metadata, now) === state) && (!category || categories.includes(category)) &&
      (!tag || tags.includes(tag)) && (!year || date?.year === year) &&
      `${typeof metadata.title === 'string' ? metadata.title : ''} ${file.path} ${categories.join(' ')} ${tags.join(' ')} ${date?.iso || ''}`.toLocaleLowerCase().includes(query);
  }).sort((a, b) => {
    const date = file => articleDate(cache.get(file.sha)?.post?.metadata)?.timestamp ?? -Infinity;
    return (date(b) - date(a) || a.path.localeCompare(b.path));
  });
}
