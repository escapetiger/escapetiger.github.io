// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
import { DataEditor, parseData, dataPath, dataLabels } from './data-editor.mjs?v=27';
import { normalizeData, clone, equal, dump, groupKeys, groupAt, entriesAt, scopeKey, unitValue, putUnit, scopesFor, changes, retainPending, saveUnits, setGroup, recoverLegacy } from './scoped-data.mjs?v=27';
const readStored = key => { try { return localStorage.getItem(key); } catch { return null; } };
const key = kind => `yicai-item-backup-v2-${kind}`;
function archive(kind, value) {
  const key = `yicai-item-legacy-archive-${kind}`, previous = readStored(key);
  if (previous && previous !== value) localStorage.setItem(`${key}-history-${crypto.randomUUID()}`, previous);
  localStorage.setItem(key, value);
}
const words = {
  en: { basic: 'Basic information', publication: 'Publication', deploymentFailed: 'Saved to GitHub · Deployment failed', deploymentPending: 'Saved to GitHub · Deployment not yet verified', back: 'Back', sectionTitle: 'Section title', text: 'Research interest', intro: 'Introduction', pdf: 'PDF path', add: 'Add entry', addSection: 'Add section', untitled: 'Untitled', removed: 'Pending deletion', dirty: 'Unsaved', clean: 'Saved', live: 'Website updated', local: 'Backed up on this device', saved: 'Saved to GitHub · Deploying', failed: 'Device backup failed. Export your edits before leaving.', storageConflict: 'Another tab changed the backup. Export your edits before continuing.', save: 'Save this item to GitHub?', saveAll: 'Save all changes in the current language to GitHub?', reset: 'Discard changes to this item?', resetAll: 'Discard all changes in the current language?', remove: 'Delete this entry? Save to apply the deletion.', removeSection: 'Delete this section and its entries in the current language? Save to apply the deletion.', more: 'More information', search: 'Search publications', all: 'All categories', allYears: 'All years', empty: 'No matching publications.', metadata: 'Section name', conflict: 'This item changed on GitHub. Your local edits have been kept.', remote: 'GitHub version', mine: 'Your version', useRemote: 'Use GitHub version', exportMine: 'Export your version', noItem: 'Select an item', legacy: 'An older backup needs manual review. Export it from File before making changes.', legacyExport: 'Export older backup', identity: 'Duplicate or invalid entry IDs. Export the data for review.', parent: 'This section was removed on GitHub. Your local edits have been kept.', invalid: 'Complete the required fields before saving.', newSection: 'New section' },
  zh: { basic: '基本信息', publication: '论文信息', deploymentFailed: '已保存到 GitHub · 部署失败', deploymentPending: '已保存到 GitHub · 尚未确认上线', back: '返回', sectionTitle: '栏目标题', text: '研究方向', intro: '个人简介', pdf: 'PDF 路径', add: '新增条目', addSection: '新增栏目', untitled: '未命名', removed: '待删除', dirty: '未保存', clean: '已保存', live: '网站已更新', local: '已备份到本机', saved: '已保存到 GitHub · 部署中', failed: '本机备份失败，离开前请导出修改。', storageConflict: '另一标签页已修改备份，请先导出当前修改。', save: '将当前项保存到 GitHub？', saveAll: '将当前语言的全部修改保存到 GitHub？', reset: '放弃当前项的未保存修改？', resetAll: '放弃当前语言的全部未保存修改？', remove: '删除当前条目？保存后生效。', removeSection: '删除当前语言的此栏目及条目？保存后生效。', more: '更多信息', search: '搜索论文', all: '全部类别', allYears: '全部年份', empty: '暂无符合条件的论文。', metadata: '栏目名称', conflict: '此项已在 GitHub 上修改，本机编辑内容已保留。', remote: 'GitHub 版本', mine: '本机版本', useRemote: '采用 GitHub 版本', exportMine: '导出本机版本', noItem: '请选择一项', legacy: '旧版备份需要人工核对，请先从文件菜单导出后再编辑。', legacyExport: '导出旧版备份', identity: '条目标识重复或无效，请导出数据核对。', parent: '此栏目已从 GitHub 删除，本机编辑内容已保留。', invalid: '请填写完整的必填信息后再保存。', newSection: '新栏目' }
};
function node(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
function button(text, action, className = 'quiet') { const element = node('button', className, text); element.type = 'button'; element.addEventListener('click', action); return element; }
const titleOf = value => typeof value === 'string' ? value : value?.title || value?.text || '';
const newId = () => `item_${crypto.randomUUID().replaceAll('-', '')}`;
export class StructuredEditor extends DataEditor {
  text(name) { return words[this.locale()][name] || super.text(name); }
  get active() { return this.records?.[this.locale()]; }
  differences(record = this.active) { return record ? changes(this.kind, record.base, record.value) : []; }
  currentDirty() {
    return !!this.scope && this.differences().some(scope => scopeKey(scope) === scopeKey(this.scope));
  }
  async open(kind, reload = false) {
    if (this.records && this.dirty && !this.backup()) throw new Error(this.text('failed'));
    if (this.kind && this.records) this.sessions.set(this.kind, { records: this.records, backupVersion: this.backupVersion, group: this.group, scope: this.scope, listScroll: this.listScroll || 0, query: this.query, category: this.category, year: this.year, legacyBackup: this.legacyBackup, legacyBlocked: this.legacyBlocked, backupReadFailed: this.backupReadFailed });
    const cached = this.sessions.get(kind);
    if (cached && !reload) { this.kind = kind; Object.assign(this, cached); this.scope = null; this.render(); return; }
    const api = this.api(), snapshot = !reload && api.latestSnapshot || await api.snapshot();
    const records = Object.fromEntries(await Promise.all(['en', 'zh'].map(async lang => {
      const path = dataPath(kind, lang), file = snapshot.files.find(file => file.path === path && file.mode === '100644'); if (!file) throw new Error(`Missing ${path}`);
      const text = await api.read(file.sha), base = normalizeData(kind, parseData(kind, text), lang);
      return [lang, { path, sha: file.sha, text, base, value: clone(base) }];
    })));
    this.kind = kind; this.records = records; this.scope = null; this.conflict = null; this.group = kind === 'cv' ? 'basic' : ''; this.listScroll = 0; this.query = ''; this.category = ''; this.year = '';
    this.backupVersion = null; this.legacyBackup = null; this.legacyBlocked = false; this.backupReadFailed = false;
    try {
      this.backupVersion = localStorage.getItem(key(kind));
      if (this.backupVersion && !reload) {
        const draft = JSON.parse(this.backupVersion);
        for (const lang of ['en', 'zh']) {
          const record = draft.records?.[lang];
          if (record?.path !== dataPath(kind, lang) || !/^[0-9a-f]{40}$/.test(record.sha)) throw new Error('Invalid backup.');
          parseData(kind, dump(record.base), true); parseData(kind, dump(record.value), true);
          record.base = normalizeData(kind, record.base, lang); record.value = normalizeData(kind, record.value, lang);
        }
        this.records = Object.fromEntries(['en', 'zh'].map(lang => [lang, draft.records[lang]]));
      }
      this.legacyBackup = localStorage.getItem(`yicai-section-backup-v1-${kind}`) || localStorage.getItem(`yicai-item-legacy-archive-${kind}`);
    } catch { this.backupReadFailed = !!this.backupVersion; this.legacyBlocked = this.backupReadFailed; this.legacyBackup = this.backupVersion; this.notify(this.text('failed'), true); }
    if (reload) { try { localStorage.removeItem(key(kind)); this.backupVersion = null; } catch { this.notify(this.text('failed'), true); } }
    const old = readStored(`yicai-section-backup-v1-${kind}`);
    if (old && this.backupVersion && !this.backupReadFailed) {
      try { archive(kind, old); if (readStored(`yicai-section-backup-v1-${kind}`) === old) localStorage.removeItem(`yicai-section-backup-v1-${kind}`); } catch { this.notify(this.text('failed'), true); }
    }
    if (old && !this.backupVersion && !reload) {
      try {
        const pair = JSON.parse(old), upgraded = {};
        for (const lang of ['en', 'zh']) {
          if (pair[lang]?.path !== dataPath(kind, lang) || !/^[0-9a-f]{40}$/.test(pair[lang].sha)) throw new Error('Invalid backup.');
          const original = parseData(kind, await api.read(pair[lang].sha));
          upgraded[lang] = { path: dataPath(kind, lang), sha: pair[lang].sha, text: pair[lang].text, ...recoverLegacy(kind, original, parseData(kind, pair[lang].text, true), lang) };
        }
        this.records = upgraded;
        if (!this.backup()) throw new Error('Backup unavailable.');
        archive(kind, old);
        if (localStorage.getItem(`yicai-section-backup-v1-${kind}`) === old) localStorage.removeItem(`yicai-section-backup-v1-${kind}`);
      } catch { this.legacyBlocked = true; this.notify(this.text('legacy'), true); }
    }
    this.render();
  }
  backup() {
    if (!this.records) return true;
    if (this.backupReadFailed) { this.notify(this.text('failed'), true); return false; }
    this.dirty = Object.values(this.records).some(record => this.differences(record).length);
    try {
      const current = localStorage.getItem(key(this.kind));
      if (current !== this.backupVersion) { this.notify(this.text('storageConflict'), true); return false; }
      if (this.dirty) {
        const next = JSON.stringify({ records: this.records }); localStorage.setItem(key(this.kind), next); this.backupVersion = next;
      } else { localStorage.removeItem(key(this.kind)); this.backupVersion = null; }
      return true;
    } catch { this.notify(this.text('failed'), true); return false; }
  }
  changed() {
    this.active.text = dump(this.active.value); this.dirty = true;
    const saved = this.backup(); this.updateSelection(); this.markRows();
    if (saved) this.setStatus(this.text('local'));
  }
  markRows() {
    const pending = new Set(this.differences().map(scopeKey));
    for (const row of this.root.querySelectorAll('[data-unit]')) {
      const scope = JSON.parse(row.dataset.unit), dirty = pending.has(scopeKey(scope));
      if (scope.type === 'entry') { const value = unitValue(this.kind, this.active.value, scope); if (value) row.querySelector('.unit-title').textContent = titleOf(value) || this.text('untitled'); }
      row.toggleAttribute('data-dirty', dirty); const state = row.querySelector('.unit-marker');
      if (state) {
        const removed = unitValue(this.kind, this.active.value, scope) === undefined; state.textContent = removed ? this.text('removed') : dirty ? '•' : ''; state.title = removed ? this.text('removed') : dirty ? this.text('dirty') : '';
        row.querySelector('.unit-row').setAttribute('aria-label', `${row.querySelector('.unit-title').textContent} ${row.querySelector('.unit-meta').textContent} ${state.title}`.trim());
      }
    }
  }
  setStatus(text) { const status = document.getElementById('data-item-status'); if (status) status.textContent = text; }
  updateSelection() {
    const section = this.kind === 'cv' && this.group !== 'basic' && !!groupAt(this.active?.value || {}, this.group);
    this.selectionChanged({ section, entry: this.scope?.type === 'entry' && unitValue(this.kind, this.active?.value, this.scope) !== undefined, selected: !!this.scope, dirty: this.currentDirty(), detail: !!this.scope, legacy: !!this.legacyBackup, legacyBlocked: !!this.legacyBlocked });
  }
  select(scope) {
    if (!this.scope) this.listScroll = window.scrollY;
    this.scope = scope; this.conflict = null; this.render();
    if (document.body.dataset.compact === 'true') window.scrollTo(0, 0);
    else this.root.querySelector('.unit-form')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  back() { this.scope = null; this.conflict = null; this.render(); requestAnimationFrame(() => window.scrollTo(0, this.listScroll || 0)); }
  row(root, scope, title, subtitle = '') {
    const item = node('div', 'unit-item'); item.dataset.unit = scopeKey(scope); item.toggleAttribute('data-selected', scopeKey(scope) === scopeKey(this.scope));
    const row = button('', () => this.select(scope), 'unit-row');
    const titleNode = node('span', 'unit-title', title || this.text('untitled')), meta = node('span', 'unit-meta', subtitle), marker = node('span', 'unit-marker');
    row.append(titleNode, meta, marker); item.append(row); root.append(item);
    if (scopeKey(scope) === scopeKey(this.scope)) this.form(item, scope, title || this.text('untitled'));
  }
  render() {
    if (!this.records) return;
    const lang = this.locale();
    if (this.renderedLang && this.renderedLang !== lang) { this.scope = null; this.conflict = null; this.group = this.kind === 'cv' ? 'basic' : ''; this.query = ''; this.category = ''; this.year = ''; }
    if (this.scope && unitValue(this.kind, this.active.base, this.scope) === undefined && unitValue(this.kind, this.active.value, this.scope) === undefined) this.scope = null;
    this.renderedLang = lang; this.root.replaceChildren(); this.root.className = 'structured-editor'; this.root.dataset.detail = String(!!this.scope);
    if (this.legacyBlocked) { const warning = node('p', 'unit-legacy', this.text('legacy')); warning.setAttribute('role', 'alert'); this.root.append(warning); }
    const toolbar = node('div', 'unit-toolbar'); this.root.append(toolbar);
    if (this.kind === 'cv') {
      const select = node('select'); select.id = 'data-group'; select.setAttribute('aria-label', this.text('sectionTitle'));
      const groups = [...new Set([...groupKeys(this.active.value), ...groupKeys(this.active.base)])];
      if (!groups.includes(this.group)) this.group = 'basic';
      select.append(new Option(this.text('basic'), 'basic'));
      for (const group of groups) select.append(new Option((groupAt(this.active.value, group) || groupAt(this.active.base, group)).title, group));
      select.value = this.group; select.addEventListener('change', () => { this.scope = null; this.conflict = null; this.group = select.value; this.listScroll = 0; this.render(); }); toolbar.append(select);
    } else {
      const input = node('input'); input.type = 'search'; input.id = 'data-search'; input.value = this.query || ''; input.placeholder = this.text('search'); input.setAttribute('aria-label', this.text('search'));
      input.addEventListener('input', () => { this.query = input.value; this.filterRows(); }); toolbar.append(input);
      const category = node('select'); category.id = 'data-category'; category.setAttribute('aria-label', lang === 'zh' ? '类别' : 'Category');
      category.append(new Option(this.text('all'), ''), new Option(lang === 'zh' ? '期刊' : 'Journal', 'journal'), new Option(lang === 'zh' ? '预印本' : 'Preprint', 'preprint')); category.value = this.category || '';
      category.addEventListener('change', () => { this.category = category.value; this.filterRows(); }); toolbar.append(category);
      const year = node('select'); year.id = 'data-year'; year.setAttribute('aria-label', lang === 'zh' ? '年份' : 'Year'); year.append(new Option(this.text('allYears'), ''));
      for (const number of [...new Set([...this.active.base, ...this.active.value].map(item => item.year).concat(this.year ? [Number(this.year)] : []))].sort((a, b) => b - a)) year.append(new Option(String(number), String(number)));
      year.value = this.year || ''; year.addEventListener('change', () => { this.year = year.value; this.filterRows(); }); toolbar.append(year);
    }
    const list = node('div', 'unit-list'); this.root.append(list);
    if (this.kind === 'cv' && this.group === 'basic') {
      for (const name of ['intro', 'pdf']) this.row(list, { type: 'field', key: name }, this.text(name), this.active.value[name]);
    } else {
      const group = this.group;
      if (this.kind === 'cv') this.row(list, { type: 'section', group }, this.text('metadata'), (groupAt(this.active.value, group) || groupAt(this.active.base, group)).title);
      const deletedSection = this.kind === 'cv' && !groupAt(this.active.value, group);
      const union = new Map((deletedSection ? [] : [...(entriesAt(this.kind, this.active.base, group) || []), ...(entriesAt(this.kind, this.active.value, group) || [])]).map(item => [item._id, item]));
      for (const item of union.values()) this.row(list, { type: 'entry', ...(this.kind === 'cv' ? { group } : {}), id: item._id }, titleOf(item), [item.year || item.date || item.date_start, item.status ? (item.status === 'journal' ? (lang === 'zh' ? '期刊' : 'Journal') : (lang === 'zh' ? '预印本' : 'Preprint')) : item.institution || item.location].filter(Boolean).join(' · '));
    }
    this.markRows(); this.filterRows(); this.updateSelection(); this.backup();
    this.setStatus(this.scope ? this.text(this.currentDirty() ? 'dirty' : 'clean') : '');
    if (this.conflict) this.renderConflict();
  }
  filterRows() {
    if (this.kind !== 'publications') return;
    for (const row of this.root.querySelectorAll('[data-unit]')) {
      const scope = JSON.parse(row.dataset.unit), item = unitValue(this.kind, this.active.value, scope) || unitValue(this.kind, this.active.base, scope);
      const selected = scopeKey(scope) === scopeKey(this.scope);
      row.hidden = !selected && (!!this.query && ![item.title, item.authors, item.publisher, item.year].join(' ').toLocaleLowerCase().includes(this.query.trim().toLocaleLowerCase()) || !!this.category && item.status !== this.category || !!this.year && String(item.year) !== this.year);
    }
    this.root.querySelector('.unit-empty')?.remove();
    if (![...this.root.querySelectorAll('.unit-item')].some(row => !row.hidden)) this.root.querySelector('.unit-list').append(node('p', 'unit-empty', this.text('empty')));
  }
  form(root, scope, title) {
    const form = node('div', 'unit-form'); form.setAttribute('aria-label', title); root.append(form);
    const heading = scope.type === 'entry' ? this.kind === 'publications' ? this.text('publication') : (groupAt(this.active.value, scope.group) || groupAt(this.active.base, scope.group)).title : title;
    form.append(node('h2', 'unit-heading', heading));
    const value = scope.type === 'section' ? groupAt(this.active.value, scope.group) : unitValue(this.kind, this.active.value, scope);
    if (value === undefined) { form.append(node('p', 'unit-deleted', this.text('removed'))); return; }
    const properties = node('div', 'data-properties'); form.append(properties);
    if (scope.type === 'field') {
      const label = node('label'); label.append(node('span', 'sr-only', this.text(scope.key))); this.fields(label, value, [scope.key], this.active.value, scope.key); properties.append(label);
    } else {
      const advanced = node('details', 'unit-more'), summary = node('summary', '', this.text('more')); advanced.append(summary);
      const secondary = node('div', 'data-properties'); advanced.append(secondary);
      const defaults = this.kind === 'publications' ? { title: '', authors: '', status: 'preprint', year: new Date().getFullYear(), publisher: '', volume: '', pages: '', pdf: '', code: '', url: '' } : {};
      const exposed = Object.fromEntries(Object.entries({ ...defaults, ...value }).filter(([key]) => key !== '_id' && !(scope.type === 'section' && ['items', 'entries'].includes(key))));
      for (const [name, item] of Object.entries(exposed)) {
        if (item && typeof item === 'object') continue;
        const wrapper = node('label'); wrapper.append(node('span', name === 'text' || scope.type === 'section' && name === 'title' ? 'sr-only' : '', name === 'text' ? this.text('text') : dataLabels[this.locale()][name] || name));
        wrapper.dataset.property = name;
        this.fields(wrapper, item, ['unit', name], value, name);
        const input = wrapper.querySelector('input, textarea, select');
        if (input) { if (input.tagName === 'TEXTAREA') input.rows = name === 'text' || name === 'detail' ? 4 : name === 'title' ? 3 : 2; input.dataset.field = name; if (name === 'text') input.setAttribute('aria-label', this.text('text')); }
        if (this.kind === 'publications' && ['volume', 'pages', 'pdf', 'code', 'url'].includes(name)) secondary.append(wrapper); else properties.append(wrapper);
      }
      if (secondary.childElementCount) form.append(advanced);
    }
  }
  addSection() {
    if (this.kind !== 'cv') return;
    const group = `custom_sections.section_${crypto.randomUUID().replaceAll('-', '')}`;
    this.active.value.custom_sections ??= {};
    this.active.value.custom_sections[group.slice(16)] = { title: this.text('newSection'), entries: [] };
    this.group = group; this.changed(); this.select({ type: 'section', group });
  }
  perform(action) {
    if (!this.records) return;
    if (action === 'add-section') { this.addSection(); return; }
    if (action === 'add-entry') {
      if (this.kind === 'cv' && (this.group === 'basic' || !groupAt(this.active.value, this.group))) return;
      const scope = { type: 'entry', ...(this.kind === 'cv' ? { group: this.group } : {}), id: newId() };
      const item = this.kind === 'publications' ? { _id: scope.id, title: '', status: 'preprint', authors: '', publisher: '', year: new Date().getFullYear(), volume: '', pages: '', pdf: '', code: '', url: '' } : this.group === 'research' ? { _id: scope.id, text: '' } : { _id: scope.id, title: '', ...(this.group === 'talks' ? { type: 'seminar', event_url: '', date_start: '', date_end: '', slides: '', location: '' } : { date: '', institution: '', detail: '', location: '' }) };
      putUnit(this.kind, this.active.value, scope, item); this.changed(); this.select(scope); return;
    }
    if (action === 'delete-section') {
      if (this.kind !== 'cv' || this.group === 'basic' || !groupAt(this.active.value, this.group) || !confirm(this.text('removeSection'))) return;
      const scope = { type: 'section', group: this.group }; putUnit(this.kind, this.active.value, scope, undefined); this.changed(); this.select(scope); return;
    }
    if (action === 'remove-entry' && this.scope?.type === 'entry' && confirm(this.text('remove'))) {
      putUnit(this.kind, this.active.value, this.scope, undefined); this.conflict = null; this.changed(); this.render();
    }
  }
  reset(all = false) {
    if (!this.records || !all && !this.scope || !confirm(this.text(all ? 'resetAll' : 'reset'))) return;
    if (all) { this.active.value = clone(this.active.base); this.scope = null; }
    else if (this.scope.type === 'section' && (!groupAt(this.active.value, this.scope.group) || !groupAt(this.active.base, this.scope.group))) {
      const current = clone(this.active.base), scope = this.scope;
      this.active.value = retainPending(this.kind, this.active.base, this.active.value, current, this.differences().filter(item => item.group === scope.group)).working;
    } else putUnit(this.kind, this.active.value, this.scope, unitValue(this.kind, this.active.base, this.scope));
    this.conflict = null; this.changed(); this.render();
  }
  export(all = false) {
    if (!this.records || !all && !this.scope) return;
    const value = all ? this.active.value : unitValue(this.kind, this.active.value, this.scope) ?? unitValue(this.kind, this.active.base, this.scope);
    const url = URL.createObjectURL(new Blob([dump(value)], { type: 'text/yaml;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${this.kind}-${this.locale()}-${all ? 'all' : this.scope.id || this.scope.key || this.scope.group}.yaml`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  exportLegacy() {
    if (!this.legacyBackup) return;
    const versions = [this.legacyBackup], prefix = `yicai-item-legacy-archive-${this.kind}-history-`;
    for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith(prefix)) versions.push(localStorage.getItem(key)); }
    const contents = versions.length > 1 ? JSON.stringify({ kind: this.kind, versions }, null, 2) : this.legacyBackup;
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' })), link = document.createElement('a'); link.href = url; link.download = `${this.kind}-older-backup.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  archiveLegacy() {
    if (!this.legacyBackup || !confirm(this.text('legacy'))) return;
    try {
      archive(this.kind, this.legacyBackup);
      if (this.backupReadFailed && readStored(key(this.kind)) !== this.backupVersion) { this.notify(this.text('storageConflict'), true); return; }
      if (this.backupReadFailed) { localStorage.removeItem(key(this.kind)); this.backupVersion = null; this.backupReadFailed = false; }
      if (localStorage.getItem(`yicai-section-backup-v1-${this.kind}`) === this.legacyBackup) localStorage.removeItem(`yicai-section-backup-v1-${this.kind}`);
    } catch { this.notify(this.text('failed'), true); return; }
    this.legacyBlocked = false; this.render();
  }
  async publish(all = false) {
    if (this.legacyBlocked) throw new Error(this.text('legacy'));
    const selected = all ? this.differences() : this.scope && this.currentDirty() ? [clone(this.scope)] : [];
    if (!selected.length || all && !confirm(this.text('saveAll'))) return;
    if (!this.backup()) throw new Error(this.text('failed'));
    const record = this.active, lang = this.locale(), base = clone(record.base), working = clone(record.value);
    try {
      const result = await saveUnits(this.api(), this.kind, lang, base, working, selected);
      Object.assign(record, retainPending(this.kind, base, working, result.value, selected));
      record.value = record.working; delete record.working; record.sha = result.files[0].sha; record.text = dump(record.value);
      this.conflict = null; this.backup(); this.render(); this.setStatus(this.text('saved'));
      if (result.commit) this.published({ ...result, kind: this.kind });
    } catch (error) {
      if (error.code === 'conflict') { this.conflict = error; this.renderConflict(); }
      error.message = this.text(error.code) || error.message; this.notify(error.message, true); throw error;
    }
  }
  renderConflict() {
    this.root.querySelector('.unit-conflict')?.remove();
    const conflict = this.conflict; if (!conflict) return;
    const panel = node('section', 'unit-conflict'); panel.setAttribute('role', 'alert'); panel.append(node('p', '', this.text('conflict')));
    for (const [name, value] of [['mine', conflict.mine], ['remote', conflict.theirs]]) {
      panel.append(node('h3', '', this.text(name)));
      const summary = node('dl'); for (const [key, text] of Object.entries(value && typeof value === 'object' ? value : { value: value ?? this.text('removed') })) if (key !== '_id') summary.append(node('dt', '', dataLabels[this.locale()][key] || key), node('dd', '', typeof text === 'object' ? JSON.stringify(text, (key, value) => key === '_id' ? undefined : value, 2) : String(text))); panel.append(summary);
    }
    panel.append(button(this.text('exportMine'), () => this.export()), button(this.text('useRemote'), () => {
      if (!confirm(this.text('reset'))) return;
      if (conflict.scope.type === 'section' && conflict.mine === undefined) { setGroup(this.active.base, conflict.scope.group, conflict.theirs); setGroup(this.active.value, conflict.scope.group, conflict.theirs); }
      else { putUnit(this.kind, this.active.base, conflict.scope, conflict.theirs); putUnit(this.kind, this.active.value, conflict.scope, conflict.theirs); }
      this.conflict = null; this.changed(); this.render();
    })); this.root.querySelector('.unit-form')?.append(panel);
  }
  clear() { super.clear(); this.scope = null; this.conflict = null; }
}
