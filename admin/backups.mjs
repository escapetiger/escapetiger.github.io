// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
import { postPath } from './core.mjs?v=3';
export const LEGACY_BACKUP_KEY = 'yicai-blog-editor-backup-v1';
export function backupRecord(input) {
  postPath(input.path);
  if (typeof input.text !== 'string' || typeof input.id !== 'string' || !/^[\w-]{1,100}$/.test(input.id)) throw new Error('Invalid local backup.');
  const originalPath = input.originalPath ?? null, originalSha = input.originalSha ?? null;
  if (originalPath) postPath(originalPath);
  if (originalSha !== null && !/^[a-f0-9]{40}$/.test(originalSha)) throw new Error('Invalid backup revision.');
  const assets = (input.assets || []).map(asset => {
    if (!/^static\/images\/blog\/[a-z0-9-]{16,80}\.(jpg|png|webp)$/.test(asset.path)) throw new Error('Invalid image path.');
    return { path: asset.path, url: '/' + asset.path.slice(7), name: String(asset.name || asset.path.split('/').at(-1)), uploaded: Boolean(asset.uploaded) };
  });
  return { id: input.id, path: input.path, text: input.text, originalPath, originalSha,
    savedState: ['draft', 'public', 'scheduled'].includes(input.savedState) ? input.savedState : input.path.split('/')[3] === 'drafts' ? 'draft' : 'public', dirty: Boolean(input.dirty), assets };
}
export function nextBackup(input, previous, expectedRevision, checkpoint = false, now = Date.now()) {
  if ((previous?.revision || 0) !== expectedRevision) {
    const error = new Error('Another tab updated this backup. Restore the latest copy or save a separate copy.');
    error.code = 'BACKUP_CONFLICT'; throw error;
  }
  const clean = backupRecord(input), history = previous?.history || [];
  if (previous && Object.keys(clean).every(key => JSON.stringify(clean[key]) === JSON.stringify(previous[key]))) return previous;
  const changed = previous && (previous.text !== clean.text || previous.path !== clean.path);
  const capture = changed && (checkpoint || !history.length || now - previous.checkpointAt >= 60000);
  const snapshot = previous && { ...backupRecord(previous), updatedAt: previous.updatedAt };
  return { ...clean, revision: expectedRevision + 1, updatedAt: now,
    checkpointAt: capture || !previous ? now : previous.checkpointAt,
    history: capture ? [snapshot, ...history].slice(0, 5) : history };
}
export class BackupStore {
  constructor(factory = globalThis.indexedDB) { this.factory = factory; }
  open() {
    if (!this.connection) this.connection = new Promise((resolve, reject) => {
      if (!this.factory) { reject(new Error('Local storage is unavailable.')); return; }
      const request = this.factory.open('yicai-blog-editor-v2', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('backups', { keyPath: 'id' });
        request.result.createObjectStore('images', { keyPath: 'path' });
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other editor tabs and retry.'));
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    });
    return this.connection;
  }
  async read(store, key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = key === undefined ? db.transaction(store).objectStore(store).getAll() : db.transaction(store).objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  async list() { return (await this.read('backups')).sort((a, b) => b.updatedAt - a.updatedAt); }
  get(id) { return this.read('backups', id); }
  image(path) { return this.read('images', path); }
  async save(input, expectedRevision, images = [], checkpoint = false) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['backups', 'images'], 'readwrite'); let result, failure;
      tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error('Local backup failed.'));
      const request = tx.objectStore('backups').get(input.id);
      request.onsuccess = () => {
        try {
          result = nextBackup(input, request.result, expectedRevision, checkpoint);
          for (const image of images) {
            if (!(image.blob instanceof Blob) || !/^static\/images\/blog\/[a-z0-9-]{16,80}\.(jpg|png|webp)$/.test(image.path)) throw new Error('Invalid image backup.');
            tx.objectStore('images').put({ path: image.path, blob: image.blob });
          }
          tx.objectStore('backups').put(result);
        } catch (error) { failure = error; tx.abort(); }
      };
    });
  }
  async remove(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['backups', 'images'], 'readwrite');
      tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error);
      if (id !== undefined) tx.objectStore('backups').delete(id);
      const remaining = tx.objectStore('backups').getAll();
      remaining.onsuccess = () => {
        const referenced = new Set(remaining.result.flatMap(record => [record, ...record.history].flatMap(copy => copy.assets.map(asset => asset.path))));
        const cursor = tx.objectStore('images').openCursor();
        cursor.onsuccess = () => { const item = cursor.result; if (item) { if (!referenced.has(item.key)) item.delete(); item.continue(); } };
      };
    });
  }
  collect() { return this.remove(undefined); }
  async migrate(storage = globalThis.localStorage) {
    const old = storage.getItem(LEGACY_BACKUP_KEY);
    if (!old) return;
    const record = backupRecord({ ...JSON.parse(old), id: 'legacy-v1', dirty: true });
    const existing = await this.get(record.id);
    if (existing && existing.text !== record.text) record.id = crypto.randomUUID();
    if (!existing || existing.text !== record.text) await this.save(record, 0);
    // Remove only after the new copy has committed, and avoid deleting another tab's update.
    if (storage.getItem(LEGACY_BACKUP_KEY) === old) storage.removeItem(LEGACY_BACKUP_KEY);
  }
}
