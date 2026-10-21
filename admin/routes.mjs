// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
export function pagePath(value) {
  if (typeof value !== 'string' || !/^\/(en|zh)\/(?:[^/?#]+\/)*$/.test(value)) return null;
  try {
    const decoded = decodeURIComponent(value);
    if (/[\\\x00-\x1f]/.test(decoded) || decoded.split('/').some(part => part === '.' || part === '..') || decoded.includes('//')) return null;
    return new URL(value, 'https://page.invalid').pathname;
  } catch { return null; }
}
export function entryFrom(params) {
  const page = pagePath(params.get('page') || params.get('return'));
  const lang = page?.split('/')[1] || (params.get('lang') === 'zh' ? 'zh' : 'en');
  const kind = ['home', 'cv', 'publications', 'blog'].includes(params.get('target')) ? params.get('target') : 'home';
  const source = params.get('source');
  let path = null;
  if (kind === 'blog' && source?.startsWith(`content/blog/${lang}/`) && source.endsWith('.md') &&
    !/[\\\x00-\x1f]/.test(source) && !source.split('/').some(part => !part || part === '.' || part === '..') && !source.split('/').at(-1).startsWith('_')) path = source;
  return { page: page || `/${lang}/`, lang, kind, path };
}
