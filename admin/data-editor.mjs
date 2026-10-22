// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
export const dataPath = (kind, lang) => {
  if (!['home', 'cv', 'publications'].includes(kind) || !['en', 'zh'].includes(lang)) throw new Error('Invalid section.');
  return `data/${lang}/${kind}.yaml`;
};
const sections = ['research', 'appointments', 'education', 'visiting', 'service', 'talks', 'posters', 'teaching'];
export function parseData(kind, text, incomplete = false) {
  const value = globalThis.jsyaml.load(text, { schema: globalThis.jsyaml.JSON_SCHEMA });
  const object = item => item && typeof item === 'object' && !Array.isArray(item);
  const check = item => {
    if (item === null || !['object', 'string', 'number', 'boolean'].includes(typeof item)) throw new Error('Unsupported data value.');
    if (typeof item === 'object') for (const [key, child] of Object.entries(item)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid data key.');
      check(child);
    }
  };
  check(value);
  if (kind === 'publications') {
    if (!Array.isArray(value)) throw new Error('Publications must be a list.');
    for (const entry of value) {
      // Older device backups retain the previous publication statuses.
      if (object(entry) && ['published', 'submitted', 'drafted'].includes(entry.status)) entry.status = entry.status === 'published' ? 'journal' : 'preprint';
      if (!object(entry) || typeof entry.title !== 'string' || (!incomplete && !entry.title.trim()) || !['journal', 'preprint'].includes(entry.status) || !Number.isInteger(entry.year) || entry.year < 1900 || entry.year > 2200) throw new Error('Each publication needs a title, status and year (1900–2200).');
    }
  } else if (kind === 'home') {
    const safeLink = link => {
      if (typeof link !== 'string' || /[\\\x00-\x20]/.test(link)) return false;
      if (/^\/(?!\/)/.test(link)) return true;
      try {
        const url = new URL(link);
        return !url.username && !url.password && (url.protocol === 'https:' || url.protocol === 'mailto:' && /^[^@]+@[^@]+$/.test(url.pathname));
      } catch { return false; }
    };
    if (!object(value) || !['title', 'subtitle', 'image', 'imageTitle', 'contactLabel', 'contactURL'].every(key => typeof value[key] === 'string') ||
      !Array.isArray(value.social) || value.social.length > 12 || value.social.some(entry => !object(entry) ||
        typeof entry.name !== 'string' || typeof entry.url !== 'string') || !incomplete && (
        !value.title.trim() || !safeLink(value.image) || /^mailto:/i.test(value.image) || !safeLink(value.contactURL) ||
        value.social.some(entry => !['email', 'github', 'googlescholar'].includes(entry.name) || !safeLink(entry.url)))) throw new Error('Invalid home profile or link.');
  } else if (kind === 'cv') {
    if (!object(value) || typeof value.intro !== 'string' || typeof value.pdf !== 'string') throw new Error('CV needs intro and pdf fields.');
    const custom = value.custom_sections ?? {};
    if (!object(custom) || Object.keys(custom).some(key => !/^section_[a-z0-9_]+$/.test(key))) throw new Error('Invalid custom CV sections.');
    for (const key of [...sections, ...Object.keys(custom)]) {
      const section = sections.includes(key) ? value[key] : custom[key];
      if (!object(section) || typeof section.title !== 'string' || (!incomplete && !section.title.trim()) || !Array.isArray(section[key === 'research' ? 'items' : 'entries'])) throw new Error(`Invalid CV section: ${key}`);
      for (const entry of section[key === 'research' ? 'items' : 'entries']) {
        if (key === 'research' ? typeof entry !== 'string' : !object(entry) || typeof entry.title !== 'string' || (!incomplete && !entry.title.trim())) throw new Error(`Invalid CV entry: ${key}`);
        if (key === 'talks' && !['seminar', 'workshop', 'conference'].includes(entry.type)) throw new Error('Invalid talk type.');
      }
    }
  } else throw new Error('Invalid section.');
  return value;
}
export async function saveData(api, kind, records) {
  const paths = ['en', 'zh'].map(lang => dataPath(kind, lang));
  if (!Array.isArray(records) || records.length !== 2 || paths.some(path => records.filter(record => record.path === path).length !== 1)) throw new Error('Both language files are required.');
  for (const record of records) parseData(kind, record.text);
  const state = await api.snapshot();
  for (const record of records) {
    const current = state.files.find(file => file.path === record.path);
    if (!current || current.mode !== '100644' || current.sha !== record.sha) throw new Error('This section changed on GitHub. Export your edits, then reload the latest version.');
  }
  const entries = [];
  for (const record of records) {
    const blob = await api.request('git/blobs', 'POST', { content: record.text, encoding: 'utf-8' });
    entries.push({ path: record.path, sha: blob.sha, mode: '100644', type: 'blob' });
  }
  const tree = await api.request('git/trees', 'POST', { base_tree: state.tree, tree: entries });
  const commit = await api.request('git/commits', 'POST', { message: `Update ${kind} in English and Chinese`, tree: tree.sha, parents: [state.head] });
  await api.request('git/refs/heads/main', 'PATCH', { sha: commit.sha, force: false });
  api.latestSnapshot = null;
  return { commit: commit.sha, files: entries };
}
const labels = {
  zh: { subtitle: '座右铭', image: '头像链接', imageTitle: '头像描述', social: '社交链接', name: '图标', contactLabel: '联系链接文字', contactURL: '联系链接', intro: '个人简介', pdf: 'PDF 路径', research: '研究方向', appointments: '工作经历', education: '教育经历', visiting: '访问经历', service: '学术服务', talks: '学术报告', posters: '海报', teaching: '教学经历', title: '标题', items: '条目', entries: '条目', date: '日期', institution: '机构', detail: '说明', location: '地点', type: '类型', event_url: '活动链接', date_start: '开始日期', date_end: '结束日期', slides: '幻灯片路径', authors: '作者', publisher: '期刊 / 出版物', volume: '卷期', pages: '页码', year: '年份', status: '类别', code: '代码链接', url: '论文链接' },
  en: { subtitle: 'Motto', image: 'Avatar URL', imageTitle: 'Avatar description', social: 'Social links', name: 'Icon', contactLabel: 'Contact label', contactURL: 'Contact URL', intro: 'Introduction', pdf: 'PDF path', research: 'Research', appointments: 'Appointments', education: 'Education', visiting: 'Visiting experience', service: 'Academic service', talks: 'Talks', posters: 'Posters', teaching: 'Teaching', title: 'Title', items: 'Items', entries: 'Entries', date: 'Date', institution: 'Institution', detail: 'Details', location: 'Location', type: 'Type', event_url: 'Event URL', date_start: 'Start date', date_end: 'End date', slides: 'Slides path', authors: 'Authors', publisher: 'Journal / publisher', volume: 'Volume', pages: 'Pages', year: 'Year', status: 'Category', code: 'Code URL', url: 'Paper URL' }
};
const blankPublication = () => ({ title: '', status: 'preprint', authors: '', publisher: '', volume: '', pages: '', year: new Date().getFullYear(), pdf: '', code: '', url: '' });
const blankEntry = key => key === 'research' ? '' : key === 'talks' ? { title: '', type: 'seminar', event_url: '', location: '', date_start: '', date_end: '', slides: '' } : { title: '', date: '', institution: '', detail: '', location: '' };
const draftKey = kind => `yicai-section-backup-v1-${kind}`;
export class DataEditor {
  constructor({ root, locale, api, notify, published }) {
    Object.assign(this, { root, locale, api, notify, published }); this.records = null; this.dirty = false; this.backupVersion = null; this.sessions = new Map();
  }
  text(key) { const zh = this.locale() === 'zh'; return ({ add: zh ? '新增' : 'Add', addSection: zh ? '新增栏目' : 'Add section', sectionTitle: zh ? '栏目标题' : 'Section title', removeSection: zh ? '删除栏目' : 'Remove section', deleteSection: zh ? '删除此栏目及其中英文条目？' : 'Remove this section and its entries in both languages?', remove: zh ? '删除此条目' : 'Remove entry', saved: zh ? '已备份 · 未发布' : 'Backed up · Unpublished', failed: zh ? '设备备份失败，请导出后再离开。' : 'Device backup failed. Export before leaving.', restore: zh ? '发现此设备上的未发布修改，是否恢复？' : 'Restore unpublished edits from this device?', publish: zh ? '发布此部分的中英文修改？' : 'Publish both language versions of this section?', reload: zh ? '重新载入会放弃此部分的未发布修改，继续？' : 'Discard unpublished changes in this section and reload?', delete: zh ? '删除当前语言的此条目？请同时检查另一语言。' : 'Remove this entry from the current language? Check the other language too.' })[key]; }
  async open(kind, reload = false) {
    if (this.kind && this.records) this.sessions.set(this.kind, { records: this.records, dirty: this.dirty, backupVersion: this.backupVersion });
    const client = this.api(), saved = this.sessions.get(kind), inventory = client.latestSnapshot;
    const current = saved && (!inventory || ['en', 'zh'].every(lang =>
      inventory.files.some(file => file.path === saved.records[lang].path && file.sha === saved.records[lang].sha)));
    if (!reload && saved && (saved.dirty || current)) {
      this.kind = kind; Object.assign(this, saved); this.render(); return;
    }
    const snapshot = !reload && inventory ? inventory : await client.snapshot();
    const pair = await Promise.all(['en', 'zh'].map(async lang => {
      const path = dataPath(kind, lang), file = snapshot.files.find(file => file.path === path && file.mode === '100644');
      if (!file) throw new Error(`Missing ${path}`);
      const text = await client.read(file.sha);
      return [lang, { path, sha: file.sha, text, value: parseData(kind, text) }];
    }));
    const records = Object.fromEntries(pair);
    this.kind = kind; this.records = records; this.dirty = false;
    try { this.backupVersion = localStorage.getItem(draftKey(kind)); } catch { this.backupVersion = null; }
    if (!reload) {
      try {
        const draft = JSON.parse(this.backupVersion);
        if (draft && ['en', 'zh'].every(lang => draft[lang]?.path === dataPath(kind, lang) && typeof draft[lang].text === 'string' && /^[0-9a-f]{40}$/.test(draft[lang].sha)) &&
          (['en', 'zh'].every(lang => draft[lang].sha === records[lang].sha) || confirm(this.text('restore')))) {
          // Drafts may contain incomplete entries. Validate the completed pair before publishing.
          for (const lang of ['en', 'zh']) { const record = draft[lang]; record.value = parseData(kind, record.text, true); }
          this.records = draft; this.dirty = true;
        }
      } catch { /* Keep the remote version when a device backup is unavailable. */ }
    }
    if (reload) { try { localStorage.removeItem(draftKey(kind)); this.backupVersion = null; } catch { /* The latest remote version is still available. */ } }
    this.render();
  }
  backup() {
    if (!this.dirty || !this.records) return true;
    try {
      const next = JSON.stringify(this.records), current = localStorage.getItem(draftKey(this.kind));
      if (current !== this.backupVersion && current !== next) throw new Error('Backup changed in another tab.');
      localStorage.setItem(draftKey(this.kind), next); this.backupVersion = next; this.notify(this.text('saved')); return true;
    }
    catch { this.notify(this.text('failed'), true); return false; }
  }
  changed() {
    this.dirty = true;
    const record = this.records[this.locale()];
    record.text = globalThis.jsyaml.dump(record.value, { lineWidth: 100, noRefs: true, schema: globalThis.jsyaml.JSON_SCHEMA });
    this.backup();
  }
  render() {
    if (!this.records) return;
    const lang = this.locale(), record = this.records[lang], zh = lang === 'zh';
    const expanded = new Set(this.renderedLang === lang ? [...this.root.querySelectorAll('details[open][data-group]')].map(node => node.dataset.group) : []);
    this.renderedLang = lang;
    this.root.replaceChildren();
    const heading = document.createElement('h1'); heading.textContent = this.kind === 'home' ? (zh ? '首页' : 'Home') : this.kind === 'cv' ? (zh ? '简历' : 'CV') : (zh ? '论文' : 'Publications'); this.root.append(heading);
    const target = document.createElement('div'); target.className = 'data-fields'; this.root.append(target);
    if (this.kind === 'cv') this.cvFields(target, record.value);
    else this.fields(target, record.value, [], record.value);
    for (const details of this.root.querySelectorAll('details[data-group]')) if (expanded.has(details.dataset.group) || details.dataset.group === this.revealPath) details.open = true;
    if (this.revealPath !== undefined) {
      const item = [...this.root.querySelectorAll('[data-group]')].find(node => node.dataset.group === this.revealPath);
      item?.querySelector('textarea, select, input')?.focus(); this.revealPath = undefined;
    }
    if (this.dirty) this.backup();
  }
  addSection() {
    const key = `section_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
    for (const lang of ['en', 'zh']) {
      const record = this.records[lang];
      record.value.custom_sections ??= {};
      record.value.custom_sections[key] = { title: lang === 'zh' ? '新栏目' : 'New section', entries: [] };
      record.text = globalThis.jsyaml.dump(record.value, { lineWidth: 100, noRefs: true, schema: globalThis.jsyaml.JSON_SCHEMA });
    }
    this.revealPath = `custom_sections.${key}`; this.dirty = true; this.backup(); this.render();
  }
  cvFields(root, value) {
    for (const key of ['intro', 'pdf']) {
      const wrapper = document.createElement('label'); wrapper.textContent = labels[this.locale()][key];
      this.fields(wrapper, value[key], [key], value, key); root.append(wrapper);
    }
    for (const key of sections) this.cvSection(root, value[key], [key]);
    for (const [key, section] of Object.entries(value.custom_sections || {})) this.cvSection(root, section, ['custom_sections', key]);
    const add = document.createElement('button'); add.type = 'button'; add.dataset.addSection = ''; add.textContent = this.text('addSection');
    add.addEventListener('click', () => this.addSection()); root.append(add);
  }
  cvSection(root, section, path) {
    const group = document.createElement('details'); group.className = 'data-section cv-edit-section'; group.dataset.group = path.join('.');
    const summary = document.createElement('summary'), title = document.createElement('span'), input = document.createElement('input');
    title.textContent = section.title; input.value = section.title; input.type = 'text'; input.dataset.field = [...path, 'title'].join('.');
    input.setAttribute('aria-label', this.text('sectionTitle')); input.addEventListener('input', () => { section.title = input.value; title.textContent = input.value; this.changed(); });
    summary.append(title, input); group.append(summary);
    const key = path[0] === 'research' ? 'items' : 'entries';
    this.fields(group, section[key], [...path, key], section, key);
    if (path[0] === 'custom_sections') {
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'quiet danger'; remove.dataset.removeSection = ''; remove.textContent = this.text('removeSection');
      remove.addEventListener('click', () => {
        if (!confirm(this.text('deleteSection'))) return;
        for (const lang of ['en', 'zh']) {
          const record = this.records[lang]; delete record.value.custom_sections?.[path[1]];
          record.text = globalThis.jsyaml.dump(record.value, { lineWidth: 100, noRefs: true, schema: globalThis.jsyaml.JSON_SCHEMA });
        }
        this.dirty = true; this.backup(); this.render();
      }); group.append(remove);
    }
    root.append(group);
  }
  fields(root, value, path, parent, key) {
    const lang = this.locale(), label = name => labels[lang][name] || name;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        const details = document.createElement(typeof entry === 'string' ? 'div' : 'details'); details.className = 'surface data-entry'; details.dataset.group = [...path, index].join('.');
        if (typeof entry !== 'string') {
          const summary = document.createElement('summary'); summary.textContent = `${index + 1}. ${entry.title || entry.name || '…'}`; details.append(summary);
        }
        this.fields(details, entry, [...path, index], value, index);
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'quiet danger'; remove.textContent = this.text('remove');
        remove.onclick = () => { if (confirm(this.text('delete'))) { value.splice(index, 1); this.changed(); this.render(); } }; details.append(remove); root.append(details);
      });
      const add = document.createElement('button'); add.type = 'button'; add.textContent = this.text('add');
      add.onclick = () => {
        for (const language of ['en', 'zh']) {
          let list = this.records[language].value;
          for (const segment of path) list = list[segment];
          list.push(this.kind === 'home' ? { name: 'github', url: 'https://github.com/' } : this.kind === 'publications' ? blankPublication() : blankEntry(path[0]));
          this.records[language].text = globalThis.jsyaml.dump(this.records[language].value, { lineWidth: 100, noRefs: true, schema: globalThis.jsyaml.JSON_SCHEMA });
        }
        this.revealPath = [...path, value.length - 1].join('.'); this.dirty = true; this.backup(); this.render();
      }; root.append(add);
    } else if (value && typeof value === 'object') {
      // Expose optional fields even when older entries omit them. Preserve unknown fields.
      const defaults = this.kind === 'publications' && path.length === 1 ? blankPublication() :
        this.kind === 'cv' && path.at(-2) === 'entries' ? blankEntry(path[0]) : {};
      for (const [name, fallback] of Object.entries(defaults)) if (!Object.hasOwn(value, name)) value[name] = fallback;
      for (const [name, child] of Object.entries(value)) {
        if (child && typeof child === 'object') {
          const group = document.createElement('details'); group.className = 'data-section'; group.dataset.group = [...path, name].join('.'); group.open = this.kind === 'publications';
          const summary = document.createElement('summary'); summary.textContent = label(name); group.append(summary); this.fields(group, child, [...path, name], value, name); root.append(group);
        } else {
          const wrapper = document.createElement('label'); wrapper.textContent = label(name); this.fields(wrapper, child, [...path, name], value, name); root.append(wrapper);
        }
      }
    } else {
      const choices = this.kind === 'home' && key === 'name' ? ['email', 'github', 'googlescholar'] : key === 'status' ? ['journal', 'preprint'] : key === 'type' ? ['seminar', 'workshop', 'conference'] : null;
      const input = document.createElement(choices ? 'select' : typeof value === 'boolean' ? 'input' : 'textarea');
      if (choices) for (const option of choices) input.append(new Option(key === 'status' ? ({ journal: lang === 'zh' ? '期刊' : 'Journal', preprint: lang === 'zh' ? '预印本' : 'Preprint' })[option] : option, option));
      if (typeof value === 'boolean') { input.type = 'checkbox'; input.checked = value; } else input.value = value ?? '';
      input.dataset.field = path.join('.'); input.setAttribute('aria-label', typeof key === 'number' ? `${label('items')} ${key + 1}` : label(key)); input.spellcheck = false;
      if (input.tagName === 'TEXTAREA') input.rows = key === 'intro' || key === 'title' ? 3 : 2;
      input.addEventListener('input', () => { parent[key] = typeof value === 'number' ? Number(input.value) : typeof value === 'boolean' ? input.checked : input.value; this.changed();
        if (key === 'title' || typeof key === 'number') {
          const summary = input.closest('.data-entry')?.querySelector('summary');
          if (summary) summary.textContent = `${path.filter(segment => typeof segment === 'number').at(-1) + 1}. ${input.value || '…'}`;
        }
      }); root.append(input);
    }
  }
  export() {
    if (!this.records) return;
    for (const lang of ['en', 'zh']) {
      const url = URL.createObjectURL(new Blob([this.records[lang].text], { type: 'text/yaml;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `${this.kind}-${lang}.yaml`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  async publish() {
    if (!this.records || !confirm(this.text('publish'))) return;
    const result = await saveData(this.api(), this.kind, Object.values(this.records));
    for (const record of Object.values(this.records)) record.sha = result.files.find(file => file.path === record.path).sha;
    this.dirty = false;
    try { if (localStorage.getItem(draftKey(this.kind)) === this.backupVersion) { localStorage.removeItem(draftKey(this.kind)); this.backupVersion = null; } } catch { /* The remote commit remains authoritative. */ }
    this.published({ ...result, kind: this.kind });
  }
  clear() { this.sessions.clear(); this.records = null; this.kind = null; this.dirty = false; this.root.replaceChildren(); }
}
