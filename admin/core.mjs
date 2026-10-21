// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
// Git operations are independent of the UI so conflict handling can be tested.
export function readPost(text, yaml = globalThis.jsyaml) {
  text = text.replace(/\r\n/g, '\n');
  const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) throw new Error('Expected YAML front matter between --- lines.');
  const nodes = [], stack = [];
  const metadata = yaml.load(match[1], {
    schema: yaml.JSON_SCHEMA,
    listener(event, state) {
      if (event === 'open') stack.push(state.position);
      else {
        const start = stack.pop();
        if (stack.length === 1) nodes.push({ start, end: state.position, value: state.result });
      }
    }
  });
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') {
    throw new Error('Front matter must be a YAML mapping.');
  }
  const fields = new Map();
  for (let i = 0; i + 1 < nodes.length; i += 2) {
    fields.set(nodes[i].value, { key: nodes[i], value: nodes[i + 1] });
  }
  return { text, front: match[1], metadata, fields, body: text.slice(match[0].length), prefix: match[0] };
}

export function updatePost(text, changes = {}, body, yaml = globalThis.jsyaml) {
  const post = readPost(text, yaml), edits = [], appended = [];
  for (const [key, value] of Object.entries(changes)) {
    if (JSON.stringify(post.metadata[key]) === JSON.stringify(value)) continue;
    const node = post.fields.get(key);
    if (Object.hasOwn(post.metadata, key) && !node) {
      throw new Error('Edit this front matter in Advanced settings.');
    }
    if (node && value === undefined) {
      edits.push({ start: node.key.start, end: node.value.end, text: '' });
    } else if (node) {
      const trailing = post.front.slice(node.value.start, node.value.end).match(/\s*$/)[0];
      edits.push({ start: node.value.start, end: node.value.end, text: ` ${JSON.stringify(value)}${trailing}` });
    } else if (value !== undefined) appended.push(`${key}: ${JSON.stringify(value)}`);
  }
  let front = post.front;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    front = front.slice(0, edit.start) + edit.text + front.slice(edit.end);
  }
  if (appended.length) front += `\n${appended.join('\n')}`;
  const result = `---\n${front}\n---\n${body ?? post.body}`;
  const checked = readPost(result, yaml).metadata;
  for (const [key, value] of Object.entries(changes)) {
    if (JSON.stringify(checked[key]) !== JSON.stringify(value)) {
      throw new Error('Could not update this field. Use Advanced settings.');
    }
  }
  return result;
}

export function articleState(path, metadata = {}, now = Date.now()) {
  if (path.split('/')[3] === 'drafts' || metadata.draft === true) return 'draft';
  if (Date.parse(metadata.publishDate || metadata.date) > now) return 'scheduled';
  return 'public';
}

export function articleURL(path, metadata = {}) {
  postPath(path);
  if (metadata.url) {
    if (typeof metadata.url !== 'string' || !metadata.url.startsWith('/') || metadata.url.startsWith('//')) return null;
    const url = new URL(metadata.url, 'https://escapetiger.github.io');
    if (url.origin !== 'https://escapetiger.github.io') return null;
    return url.pathname;
  }
  const parts = path.split('/').slice(3);
  if (parts[0] === 'drafts') return null;
  const name = parts.pop().replace(/\.md$/, '');
  const slug = typeof metadata.slug === 'string' ? metadata.slug : name;
  if (slug !== 'index') parts.push(slug);
  return `/${path.split('/')[2]}/blog/${parts.map(part => encodeURIComponent(part.toLowerCase())).join('/')}/`;
}

export function postPath(path) {
  if (!/^content\/blog\/(en|zh)\/(?:[^/]+\/)*[^/]+\.md$/.test(path) ||
      path.split('/').some(part => ['.', '..'].includes(part) || /[\x00-\x1f\\]/.test(part)) ||
      path.split('/').at(-1).startsWith('_index.')) {
    throw new Error('Use an article path under content/blog/en/ or content/blog/zh/ ending in .md.');
  }
  return path;
}

export function preparePost(text, path, action, yaml = globalThis.jsyaml) {
  postPath(path);
  text = text.replace(/\r\n/g, '\n');
  const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) throw new Error('Expected YAML front matter between --- lines.');
  const metadata = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object' ||
      typeof metadata.title !== 'string' || !metadata.title.trim()) {
    throw new Error('Front matter must include a nonempty title.');
  }
  if (!['draft', 'publish'].includes(action)) throw new Error('Unknown save action.');
  const draft = action === 'draft';
  // Preserve metadata formatting, comments, formulas and the entire article body.
  let front = match[1];
  const fields = [...front.matchAll(/^draft\s*:[^\n]*$/gm)];
  if (fields.length > 1 || (Object.hasOwn(metadata, 'draft') && fields.length !== 1) ||
      Object.keys(metadata).some(key => key.toLowerCase() === 'draft' && key !== 'draft')) {
    throw new Error('Use one unquoted top-level draft: true or draft: false field.');
  }
  if (fields.length) {
    if (!/^draft\s*:\s*(true|false)\s*(#.*)?$/i.test(fields[0][0])) {
      throw new Error('Use a plain boolean draft field.');
    }
    const comment = fields[0][0].match(/\s+#.*$/)?.[0] || '';
    front = front.replace(/^draft\s*:[^\n]*$/m, `draft: ${draft}${comment}`);
  } else front += `\ndraft: ${draft}`;
  if (yaml.load(front, { schema: yaml.JSON_SCHEMA }).draft !== draft) {
    throw new Error('Could not update the draft field.');
  }
  const parts = path.split('/');
  if (draft && parts[3] !== 'drafts') parts.splice(3, 0, 'drafts');
  if (!draft && parts[3] === 'drafts') parts.splice(3, 1);
  const target = postPath(parts.join('/'));
  // Repeated drafts directories would remain unpublished after a move.
  if (!draft && target.split('/')[3] === 'drafts') throw new Error('Invalid nested drafts path.');
  return { path: target, text: `---\n${front}\n---${match[0].endsWith('\n') ? '\n' : ''}${text.slice(match[0].length)}` };
}

export function newPost(title, now = new Date()) {
  return `---\ntitle: ${JSON.stringify(title)}\ndate: ${now.toISOString()}\ndraft: true\ntags: []\ncategories: []\nmath: true\n---\n\n`;
}

export class GitHub {
  constructor(token, fetcher = globalThis.fetch) {
    this.token = token;
    this.fetcher = fetcher.bind(globalThis);
    this.repo = 'escapetiger/hugo-yicai';
    this.branch = 'main';
    this.publicCache = new Map();
  }

  async request(path, method = 'GET', data) {
    return this.call(this.repo, path, method, data, true);
  }

  async publicRequest(repo, path) {
    const key = `${repo}/${path}`, cached = this.publicCache.get(key);
    if (cached && cached.until > Date.now()) return cached.promise;
    const promise = this.call(repo, path, 'GET', undefined, false);
    this.publicCache.set(key, { promise, until: Date.now() + (path.startsWith('compare/') ? 3600000 : 25000) });
    try { return await promise; }
    catch (error) { this.publicCache.delete(key); throw error; }
  }

  async call(repo, path, method, data, authenticated) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await this.fetcher(`https://api.github.com/repos/${repo}/${path}`, {
        method, cache: 'no-store', credentials: 'omit', redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          ...(authenticated ? { Authorization: `Bearer ${this.token}` } : {}),
          'X-GitHub-Api-Version': '2022-11-28',
          ...(data ? { 'Content-Type': 'application/json' } : {})
        },
        ...(data ? { body: JSON.stringify(data) } : {})
      });
      if (!response.ok) {
        const error = new Error(`GitHub HTTP ${response.status}. ${
          response.status === 401 ? 'Check your token and its expiration.' :
          response.status === 403 ? 'Check Contents permission, repository access, or rate limits.' :
          response.status === 409 || response.status === 422 ? 'The branch changed or a repository rule blocked this update. Reload the article before retrying.' :
          'Check repository access and network, then retry.'}`);
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } finally { clearTimeout(timer); }
  }

  async snapshot() {
    const ref = await this.request(`git/ref/heads/${this.branch}`);
    const commit = await this.request(`git/commits/${ref.object.sha}`);
    const tree = await this.request(`git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new Error('Repository listing is incomplete. No changes were made.');
    return { head: ref.object.sha, tree: commit.tree.sha, files: tree.tree };
  }

  async read(sha) {
    const blob = await this.request(`git/blobs/${sha}`);
    if (blob.encoding !== 'base64') throw new Error('Unsupported file encoding.');
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(atob(blob.content.replace(/\s/g, '')), c => c.charCodeAt(0)));
  }

  async save({ originalPath, originalSha, path, text, action }) {
    const prepared = preparePost(text, path, action);
    if (originalPath) postPath(originalPath);
    const state = await this.snapshot();
    const original = state.files.find(file => file.path === originalPath);
    if (originalPath && (!original || original.sha !== originalSha || original.mode !== '100644')) {
      throw new Error('This article changed on GitHub. Export your edits, then reopen the latest article.');
    }
    if ((!originalPath || prepared.path !== originalPath) &&
        state.files.some(file => file.path === prepared.path)) {
      throw new Error('The destination already exists. Choose a different path or open that article.');
    }
    const blob = await this.request('git/blobs', 'POST', { content: prepared.text, encoding: 'utf-8' });
    const entries = [{ path: prepared.path, mode: '100644', type: 'blob', sha: blob.sha }];
    if (originalPath && originalPath !== prepared.path) {
      entries.push({ path: originalPath, mode: '100644', type: 'blob', sha: null });
    }
    const tree = await this.request('git/trees', 'POST', { base_tree: state.tree, tree: entries });
    const commit = await this.request('git/commits', 'POST', {
      message: `${action === 'publish' ? 'Publish' : 'Save draft'}: ${prepared.path}`,
      tree: tree.sha, parents: [state.head]
    });
    // A non-fast-forward update fails if another device commits in the meantime.
    await this.request(`git/refs/heads/${this.branch}`, 'PATCH', { sha: commit.sha, force: false });
    return { ...prepared, sha: blob.sha, commit: commit.sha };
  }
}
