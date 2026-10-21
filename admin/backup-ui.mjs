// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
import { readPost } from './core.mjs?v=9';
export function drawBackups(container, records, { t, locale, restore, remove, download, image }) {
  const date = value => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const nodes = records.map(record => {
    const card = document.createElement('article'); card.className = 'backup-card'; card.dataset.id = record.id;
    const title = document.createElement('h2');
    try { title.textContent = readPost(record.text).metadata.title || record.path; } catch { title.textContent = record.path; }
    const detail = document.createElement('p'); detail.className = 'hint'; detail.textContent = record.path;
    const time = document.createElement('p'); time.className = 'hint'; time.textContent = date(record.updatedAt);
    const actions = document.createElement('div'); actions.className = 'backup-actions';
    const button = (key, action) => { const node = document.createElement('button'); node.type = 'button'; node.textContent = t(key); node.addEventListener('click', action); return node; };
    actions.append(button('restoreVersion', () => restore(record, record)), button('export', () => download(record)), button('deleteBackup', () => remove(record)));
    const versions = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = `${t('history')} (${record.history.length})`; versions.append(summary);
    for (const snapshot of record.history) {
      const version = button('restoreVersion', () => restore(record, snapshot)); version.className = 'version-button'; version.textContent = `${date(snapshot.updatedAt)} · ${t('restoreVersion')}`; versions.append(version);
    }
    const images = document.createElement('div'); images.className = 'backup-images';
    const allImages = new Map([record, ...record.history].flatMap(copy => copy.assets).map(asset => [asset.path, asset]));
    for (const asset of allImages.values()) {
      const node = button('downloadImage', () => image(asset)); node.textContent += `: ${asset.name}`; images.append(node);
    }
    card.append(title, detail, time, actions, versions, images); return card;
  });
  if (!nodes.length) { const empty = document.createElement('p'); empty.textContent = t('noBackup'); nodes.push(empty); }
  container.replaceChildren(...nodes);
}
