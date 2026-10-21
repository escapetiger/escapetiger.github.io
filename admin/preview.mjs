// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
export function markdownRenderer(markdownit = globalThis.markdownit, katex = globalThis.katex) {
  const md = markdownit({ html: false, linkify: true, typographer: false });
  function closing(source, marker, start) {
    let at = source.indexOf(marker, start);
    while (at !== -1) {
      let slashes = 0; for (let i = at - 1; i >= 0 && source[i] === '\\'; i--) slashes++;
      if (slashes % 2 === 0) return at;
      at = source.indexOf(marker, at + marker.length);
    }
    return -1;
  }
  md.inline.ruler.before('escape', 'site_math', (state, silent) => {
    const open = state.src.slice(state.pos, state.pos + 2);
    if (open !== '\\(' && open !== '\\[') return false;
    const end = closing(state.src, open === '\\(' ? '\\)' : '\\]', state.pos + 2);
    if (end === -1) return false;
    if (!silent) { const token = state.push('site_math', '', 0); token.content = state.src.slice(state.pos + 2, end); token.meta = { display: open === '\\[' }; }
    state.pos = end + 2; return true;
  });
  md.block.ruler.before('paragraph', 'site_math_block', (state, start, end, silent) => {
    const begin = state.bMarks[start] + state.tShift[start];
    if (state.sCount[start] - state.blkIndent >= 4 || state.src.slice(begin, begin + 2) !== '\\[') return false;
    const finish = closing(state.src, '\\]', begin + 2);
    if (finish < 0) return false;
    let last = start; while (last < end && state.eMarks[last] < finish + 2) last++;
    if (last >= end || state.src.slice(finish + 2, state.eMarks[last]).trim()) return false;
    if (!silent) {
      const token = state.push('site_math_block', 'div', 0); token.block = true;
      token.content = state.src.slice(begin + 2, finish); token.map = [start, last + 1];
    }
    state.line = last + 1; return true;
  });
  const renderMath = (source, displayMode) => katex.renderToString(source, {
    displayMode, throwOnError: false, strict: false, trust: false, maxSize: 20, maxExpand: 1000
  });
  md.renderer.rules.site_math = (tokens, index) => renderMath(tokens[index].content, tokens[index].meta.display);
  md.renderer.rules.site_math_block = (tokens, index) => renderMath(tokens[index].content, true) + '\n';
  const imageRule = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index];
    try {
      const url = new URL(token.attrGet('src'), env.base);
      if (!['https:', 'http:'].includes(url.protocol)) return md.utils.escapeHtml(token.content);
      token.attrSet('src', env.images?.get(url.href) || url.href);
      token.attrSet('loading', 'lazy'); token.attrSet('referrerpolicy', 'no-referrer');
    } catch { return md.utils.escapeHtml(token.content); }
    return imageRule(tokens, index, options, env, self);
  };
  return md;
}
let renderer;
const sanitizers = new WeakMap();
export function renderPreview(frame, { body, title, base, images, locale }) {
  const doc = frame.contentDocument;
  if (!doc?.getElementById('content') || !globalThis.DOMPurify) return false;
  renderer ||= markdownRenderer();
  const html = renderer.render(body, { base, images });
  // Parse generated formula styles under the preview document's policy, not the editor's.
  if (!sanitizers.has(doc)) sanitizers.set(doc, DOMPurify(frame.contentWindow));
  const safe = sanitizers.get(doc).sanitize(html, { USE_PROFILES: { html: true, svg: true, mathMl: true },
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'base', 'link', 'meta'], FORBID_ATTR: ['id', 'name'] });
  doc.documentElement.lang = locale;
  doc.getElementById('title').textContent = title;
  doc.getElementById('content').innerHTML = safe;
  // Keep preview links from navigating the sandbox away from its trusted document.
  doc.onclick = event => { if (event.target.closest('a')) event.preventDefault(); };
  return true;
}
