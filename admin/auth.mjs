// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
import { GitHub } from './core.mjs?v=9';
export const siteOrigin = 'https://escapetiger.github.io';
export async function authRequest(path, options = {}, fetcher = globalThis.fetch) {
  const response = await fetcher(`/admin/auth/${path}`, { ...options, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(25000) });
  if (!response.ok) { const error = new Error(`Login service HTTP ${response.status}`); error.status = response.status; throw error; }
  return response.json();
}
export async function authConfiguration(fetcher = globalThis.fetch) {
  const response = await fetcher('auth-config.json', { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('Cannot load login configuration.');
  const config = await response.json();
  if (config.mode === 'github') return { mode: 'github', ready: config.ready === true };
  if (config.mode !== 'token') throw new Error('Invalid login configuration.');
  let loginURL = null;
  if (config.loginURL) {
    const target = new URL(config.loginURL);
    if (target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/admin/' || target.search || target.hash) throw new Error('Invalid login address.');
    loginURL = target.href;
  }
  return { mode: 'token', loginURL };
}
export class SessionGitHub extends GitHub {
  constructor(session, expiredMessage, fetcher = globalThis.fetch) {
    super('', fetcher); this.session = session; this.expiredMessage = expiredMessage;
  }
  async request(path, method = 'GET', data) {
    const response = await this.fetcher(`/admin/api/github/${path}`, {
      method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'X-CSRF-Token': this.session.csrf, ...(data ? { 'Content-Type': 'application/json' } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {})
    });
    if (!response.ok) {
      const error = new Error(response.status === 401 ? this.expiredMessage : `GitHub HTTP ${response.status}.`);
      error.status = response.status; throw error;
    }
    return response.json();
  }
  async logout() { return authRequest('logout', { method: 'POST', headers: { 'X-CSRF-Token': this.session.csrf } }, this.fetcher); }
}
