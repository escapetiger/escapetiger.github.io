// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
// Block boundaries come from the renderer; all unedited bytes, including gaps, survive.
export function splitBlocks(source, renderer) {
  const tokens = renderer.parse(source, {}), lines = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lines.push(i + 1);
  const blocks = []; let depth = 0;
  for (const token of tokens) {
    if (depth === 0 && token.map) {
      const start = lines[token.map[0]] ?? source.length, end = lines[token.map[1]] ?? source.length;
      if (!blocks.length || start >= blocks.at(-1).end) blocks.push({ start, end, type: token.type.replace(/_open$/, ''), text: source.slice(start, end) });
    }
    depth += token.nesting;
  }
  return blocks;
}
export function replaceBlock(source, block, text) {
  if (source.slice(block.start, block.end) !== block.text) throw new Error('The selected block changed. Select it again.');
  return source.slice(0, block.start) + text + source.slice(block.end);
}
export function blockTemplate(type) {
  return ({ paragraph: 'Text\n\n', heading: '## Heading\n\n', blockquote: '> Quote\n\n', bullet_list: '- Item\n\n', ordered_list: '1. Item\n\n', fence: '```text\n\n```\n\n', site_math_block: '\\[\n\n\\]\n\n', image: '![](/images/)\n\n' })[type] || '\n\n';
}
// Deliberately edit literal runs only. Links, delimiters, formulas and unsupported
// syntax are never reconstructed from browser-generated HTML.
export function literalRuns(source) {
  if (/\{\{|<\/?[a-zA-Z][^>]*>/.test(source)) return [];
  const runs = []; let at = 0;
  const add = (start, end, tag = 'span', kind = 'text') => { if (end > start && source.slice(start, end).trim()) runs.push({ start, end, text: source.slice(start, end), tag, kind }); };
  while (at < source.length) {
    if (at === 0 || source[at - 1] === '\n') {
      const prefix = source.slice(at).match(/^(?: {0,3}#{1,6}\s+|>\s*|\s*(?:[-+*]|\d+[.)])\s+)/); if (prefix) { at += prefix[0].length; continue; }
    }
    if (source.slice(at, at + 2) === '\\(' || source.slice(at, at + 2) === '\\[') {
      const close = source.slice(at, at + 2) === '\\(' ? '\\)' : '\\]', end = source.indexOf(close, at + 2);
      if (end < 0) return []; add(at + 2, end, 'span', 'formula'); at = end + 2; continue;
    }
    const link = source.slice(at).match(/^\[([^\]\n]*)\]\(([^\s()]+)(?:\s+"[^"\n]*")?\)/);
    if (link) { add(at + 1, at + 1 + link[1].length, 'span', 'linkText'); const start = at + link[0].indexOf('](') + 2; add(start, start + link[2].length, 'span', 'url'); at += link[0].length; continue; }
    if ('[!<{}'.includes(source[at])) return [];
    if (source[at] === '\\') { at += 2; continue; }
    if ('*_`'.includes(source[at])) {
      const delimiter = source[at].repeat(source[at + 1] === source[at] ? 2 : 1), end = source.indexOf(delimiter, at + delimiter.length);
      if (end >= 0) { const value = source.slice(at + delimiter.length, end); if (!/[\[\\]/.test(value)) add(at + delimiter.length, end, source[at] === '`' ? 'code' : delimiter.length === 2 ? 'strong' : 'em'); else return []; at = end + delimiter.length; continue; }
    }
    const start = at++; while (at < source.length && !'\\[*_`!<{}\n'.includes(source[at])) at++; add(start, at);
  }
  return runs;
}
export class BlockEditor {
  constructor(root, options) { this.root = root; Object.assign(this, options); this.selected = null; }
  render(source) {
    if (!this.renderer) return;
    this.source = source; this.blocks = splitBlocks(source, this.renderer); this.selected = null; this.root.replaceChildren();
    this.blocks.forEach((block, index) => {
      const item = document.createElement('section'); item.className = 'writing-block'; item.dataset.block = index;
      const display = document.createElement('div'); display.className = 'block-display';
      display.innerHTML = DOMPurify.sanitize(this.renderer.render(block.text), { FORBID_TAGS: ['script', 'iframe', 'style', 'form', 'input'], FORBID_ATTR: ['style', 'id', 'name'], ALLOW_DATA_ATTR: false });
      display.querySelectorAll('a').forEach(link => link.addEventListener('click', event => event.preventDefault()));
      const tools = document.createElement('div'); tools.className = 'block-tools'; tools.hidden = true;
      const action = (label, callback) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', callback); tools.append(b); return b; };
      const zh = this.locale() === 'zh';
      action(zh ? '编辑' : 'Edit', () => this.edit(item, block, index));
      action('↑', () => this.move(index, -1)).setAttribute('aria-label', zh ? '上移' : 'Move up');
      action('↓', () => this.move(index, 1)).setAttribute('aria-label', zh ? '下移' : 'Move down');
      action(zh ? '删除' : 'Delete', () => { if (confirm(zh ? '删除这个内容块？' : 'Delete this block?')) this.apply(replaceBlock(this.source, block, '')); });
      item.addEventListener('click', () => { this.selected = index; this.root.querySelectorAll('.block-tools').forEach(el => el.hidden = el !== tools); this.root.querySelectorAll('.writing-block').forEach(el => el.toggleAttribute('data-selected', el === item)); });
      item.append(display, tools); this.root.append(item);
    });
    if (!this.blocks.length) {
      const add = document.createElement('button'); add.type = 'button'; add.textContent = this.locale() === 'zh' ? '开始写作' : 'Start writing'; add.addEventListener('click', () => this.add('paragraph')); this.root.append(add);
    }
  }
  apply(source) { this.change(source); this.render(source); }
  add(type) { this.apply(this.source + (this.source && !this.source.endsWith('\n\n') ? '\n\n' : '') + blockTemplate(type)); const item = this.root.querySelector('.writing-block:last-child'); item?.click(); if (item) this.edit(item, this.blocks.at(-1), this.blocks.length - 1); }
  insertAfter(index) {
    const at = this.blocks[index].end; this.apply(this.source.slice(0, at) + '\n' + blockTemplate('paragraph') + this.source.slice(at));
    const item = this.root.querySelectorAll('.writing-block')[index + 1]; item?.click(); if (item) this.edit(item, this.blocks[index + 1], index + 1);
  }
  move(index, delta) {
    const next = index + delta; if (next < 0 || next >= this.blocks.length) return;
    const first = this.blocks[Math.min(index, next)], last = this.blocks[Math.max(index, next)];
    this.apply(this.source.slice(0, first.start) + last.text + this.source.slice(first.end, last.start) + first.text + this.source.slice(last.end));
  }
  edit(item, block, index) {
    if (item.querySelector('.block-edit')) return;
    const panel = document.createElement('div'); panel.className = 'block-edit'; const zh = this.locale() === 'zh';
    let current = block.text;
    const commit = value => { const delta = value.length - block.text.length; current = value; this.source = replaceBlock(this.source, block, current); block.text = current; block.end = block.start + current.length; for (const later of this.blocks.slice(index + 1)) { later.start += delta; later.end += delta; } this.change(this.source); };
    const input = (label, value, apply, multiline = true) => {
      const wrap = document.createElement('label'); wrap.textContent = label; const field = document.createElement(multiline ? 'textarea' : 'input'); field.value = value; field.setAttribute('aria-label', label); field.addEventListener('input', () => apply(field.value)); wrap.append(field); panel.append(wrap); return field;
    };
    const code = current.match(/^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n?\1[^\n]*(\n*)$/), math = current.match(/^(\s*\\\[\s*\n?)([\s\S]*?)(\\\]\s*)$/), image = current.trim().match(/^!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/);
    if (code) {
      let language = code[2], content = code[3]; const update = () => { const marker = '~'.repeat(Math.max(3, ...[...content.matchAll(/~+/g)].map(m => m[0].length + 1))); commit(`${marker}${language.replace(/\n/g, '')}\n${content}\n${marker}\n\n`); };
      input(zh ? '语言' : 'Language', language, value => { language = value; update(); }, false); input(zh ? '代码' : 'Code', content, value => { content = value; update(); });
    } else if (math) input(zh ? '公式' : 'Formula', math[2], value => commit(math[1] + value + math[3]));
    else if (image) {
      let alt = image[1], url = image[2], caption = image[3] || ''; const update = () => commit(`![${alt.replace(/[\]\\\n]/g, '')}](${url.replace(/[\s()]/g, '')}${caption ? ` "${caption.replace(/["\n]/g, '')}"` : ''})\n\n`);
      input(zh ? '替代文本' : 'Alternative text', alt, value => { alt = value; update(); }, false); input('URL', url, value => { url = value; update(); }, false); input(zh ? '图注' : 'Caption', caption, value => { caption = value; update(); }, false);
    } else {
      const runs = literalRuns(current);
      if (runs.length) {
        const editor = document.createElement('div'); editor.className = 'literal-editor';
        let activeRun = null, activeField = null;
        const formats = document.createElement('div'); formats.className = 'inline-format-tools';
        for (const [label, marker] of [['B', '**'], ['I', '*'], [zh ? '链接' : 'Link', 'link']]) {
          const tool = document.createElement('button'); tool.type = 'button'; tool.textContent = label; tool.setAttribute('aria-label', marker === '**' ? (zh ? '加粗' : 'Bold') : marker === '*' ? (zh ? '斜体' : 'Italic') : (zh ? '插入链接' : 'Insert link'));
          tool.addEventListener('pointerdown', event => event.preventDefault());
          tool.addEventListener('click', () => {
            if (!activeRun || !activeField || activeRun.kind !== 'text') return;
            const selection = getSelection(); let start = 0, end = activeField.textContent.length;
            if (selection.rangeCount && activeField.contains(selection.anchorNode) && activeField.contains(selection.focusNode)) { const range = selection.getRangeAt(0), prefix = range.cloneRange(); prefix.selectNodeContents(activeField); prefix.setEnd(range.startContainer, range.startOffset); start = prefix.toString().length; end = start + range.toString().length; if (start === end) { start = 0; end = activeField.textContent.length; } }
            const from = activeRun.start + start, to = activeRun.start + end, text = current.slice(from, to); let value = marker + text + marker;
            if (marker === 'link') { const url = prompt(zh ? '链接地址' : 'Link URL', 'https://'); if (!url) return; try { if (!['https:', 'http:', 'mailto:'].includes(new URL(url).protocol) || /[\s()]/.test(url)) return; } catch { return; } value = `[${text.replace(/[\[\]\n]/g, '')}](${url})`; }
            commit(current.slice(0, from) + value + current.slice(to)); this.render(this.source); const target = this.root.querySelectorAll('.writing-block')[index]; target.click(); this.edit(target, this.blocks[index], index);
          }); formats.append(tool);
        }
        panel.append(formats, editor);
        for (const run of runs) {
          const field = document.createElement(run.tag); field.textContent = run.text; field.contentEditable = 'plaintext-only'; field.setAttribute('role', 'textbox'); field.setAttribute('aria-label', run.kind === 'formula' ? (zh ? '行内公式' : 'Inline formula') : run.kind === 'url' ? 'URL' : (zh ? '文字' : 'Text')); field.setAttribute('aria-multiline', 'true');
          field.addEventListener('focus', () => { activeRun = run; activeField = field; });
          field.addEventListener('beforeinput', event => { if (event.inputType === 'insertParagraph' && block.type === 'paragraph' && run.kind === 'text') { event.preventDefault(); this.insertAfter(index); } });
          field.addEventListener('input', () => {
            const value = field.textContent, before = current.slice(0, run.start), after = current.slice(run.end), shift = value.length - (run.end - run.start);
            commit(before + value + after); for (const other of runs) if (other.start > run.start) { other.start += shift; other.end += shift; } run.end += shift;
          }); if (['formula', 'url', 'linkText'].includes(run.kind)) { const label = document.createElement('label'); label.textContent = run.kind === 'formula' ? (zh ? '行内公式' : 'Inline formula') : run.kind === 'url' ? 'URL' : (zh ? '链接文字' : 'Link text'); label.append(field); editor.append(label); } else editor.append(field);
        }
      } else {
        // Opaque syntax remains opt-in and lossless. It is never converted to HTML and back.
        const message = document.createElement('p'); message.textContent = zh ? '此内容包含特殊格式，已原样保留。可移动、导出或删除此内容块。' : 'Special formatting is preserved. You can move, export or delete this block.'; panel.append(message);
      }
    }
    if (['bullet_list', 'ordered_list'].includes(block.type)) { const add = document.createElement('button'); add.type = 'button'; add.textContent = zh ? '新增条目' : 'Add entry'; add.addEventListener('click', () => { const count = (current.match(/^\s*(?:[-+*]|\d+[.)])\s/gm) || []).length; commit(current.trimEnd() + '\n' + (block.type === 'ordered_list' ? `${count + 1}. ` : '- ') + (zh ? '新条目' : 'New item') + '\n'); this.render(this.source); const next = this.root.querySelectorAll('.writing-block')[index]; next.click(); this.edit(next, this.blocks[index], index); }); panel.append(add); }
    if (block.type === 'heading') { const label = document.createElement('label'); label.textContent = zh ? '标题级别' : 'Heading level'; const select = document.createElement('select'); select.setAttribute('aria-label', label.textContent); for (let level = 1; level <= 6; level++) select.append(new Option(`H${level}`, String(level))); select.value = String(current.match(/^ {0,3}(#{1,6})/)?.[1].length || 2); select.addEventListener('change', () => { commit(current.replace(/^( {0,3})#{1,6}/, (_, space) => space + '#'.repeat(Number(select.value)))); this.render(this.source); const target = this.root.querySelectorAll('.writing-block')[index]; target.click(); this.edit(target, this.blocks[index], index); }); label.append(select); panel.append(label); }
    const done = document.createElement('button'); done.type = 'button'; done.textContent = zh ? '完成' : 'Done'; done.addEventListener('click', () => this.render(this.source)); panel.append(done); item.append(panel); panel.querySelector('[contenteditable],input,textarea')?.focus();
  }
}
