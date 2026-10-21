// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
const namespace = 'yicai-editor-repository-v1';
const validSHA = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const maxEntries = 48, maxBytes = 128 * 1024;
export function validSnapshot(value, head) {
  return validSHA(head) && value?.head === head && validSHA(value.tree) && Array.isArray(value.files) &&
    value.files.every(file => file && typeof file.path === 'string' && validSHA(file.sha) &&
      typeof file.mode === 'string' && ['blob', 'tree', 'commit'].includes(file.type));
}
// Only immutable repository objects are cached. The branch head is always checked online.
export class RepositoryCache {
  constructor(storage = () => globalThis.caches, origin = globalThis.location?.origin || 'https://editor.invalid') {
    this.storage = storage; this.origin = origin; this.memory = new Map(); this.closed = false;
  }
  key(type, sha) { return `${this.origin}/admin/.read-cache/${type}/${sha}`; }
  async get(type, sha) {
    if (this.closed || !validSHA(sha)) return undefined;
    const key = this.key(type, sha);
    if (this.memory.has(key)) return this.memory.get(key);
    try {
      const cache = await this.storage()?.open(namespace), response = await cache?.match(key);
      if (!response || this.closed) return undefined;
      const text = await response.text();
      if (this.closed || new TextEncoder().encode(text).length > maxBytes) return undefined;
      this.remember(key, text); return text;
    } catch { return undefined; }
  }
  remember(key, text) {
    this.memory.set(key, text);
    while (this.memory.size > maxEntries) this.memory.delete(this.memory.keys().next().value);
  }
  async put(type, sha, text) {
    if (this.closed || !validSHA(sha) || typeof text !== 'string' || new TextEncoder().encode(text).length > maxBytes) return;
    const key = this.key(type, sha); this.remember(key, text);
    try {
      const cache = await this.storage()?.open(namespace);
      if (!cache || this.closed) return;
      await cache.put(key, new Response(text));
      const keys = await cache.keys();
      for (const old of keys.slice(0, Math.max(0, keys.length - maxEntries))) await cache.delete(old);
    } catch { /* Storage is an optimization; quota or private-mode failures never block editing. */ }
  }
  async snapshot(head) {
    try { const value = JSON.parse(await this.get('tree', head)); return validSnapshot(value, head) ? value : undefined; }
    catch { return undefined; }
  }
  async saveSnapshot(value) {
    if (!validSnapshot(value, value?.head)) return;
    await this.put('tree', value.head, JSON.stringify({ head: value.head, tree: value.tree,
      files: value.files.map(({ path, sha, type, mode }) => ({ path, sha, type, mode })) }));
  }
  async clear() {
    this.closed = true; this.memory.clear();
    try { await this.storage()?.delete(namespace); } catch { /* Editing and logout still work without cache storage. */ }
  }
}
