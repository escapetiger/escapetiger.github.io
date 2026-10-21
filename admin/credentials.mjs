// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
// Persistence is an explicit trusted-device choice, not a confidentiality boundary.
export const credentialKey = 'yicai-blog-credential-v1';
export class Credentials {
  constructor(storage = () => globalThis.localStorage) { this.storage = storage; }
  read() {
    try {
      const record = JSON.parse(this.storage().getItem(credentialKey));
      return record?.version === 1 && record.repository === 'escapetiger/hugo-yicai' &&
        typeof record.token === 'string' && record.token.trim() ? record.token.trim() : null;
    } catch { return null; }
  }
  save(token) {
    try {
      if (typeof token !== 'string' || !token.trim()) return false;
      this.storage().setItem(credentialKey, JSON.stringify({ version: 1, repository: 'escapetiger/hugo-yicai', token: token.trim() }));
      return this.read() === token.trim();
    } catch { return false; }
  }
  clear() {
    try { this.storage().removeItem(credentialKey); return this.storage().getItem(credentialKey) === null; }
    catch { return false; }
  }
}
