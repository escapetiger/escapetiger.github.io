// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
const scripts = new Map(), frames = new WeakMap();
function script(source, name) {
  if (globalThis[name]) return Promise.resolve();
  if (scripts.has(source)) return scripts.get(source);
  const task = new Promise((resolve, reject) => {
    const element = document.createElement('script');
    const finish = error => {
      clearTimeout(timer); element.onload = element.onerror = null;
      if (error) { element.remove(); reject(error); } else resolve();
    };
    const timer = setTimeout(() => finish(new Error('Preview resource timed out. Retry the preview.')), 20000);
    element.src = source; element.async = true;
    element.onload = () => finish(globalThis[name] ? null : new Error('Preview resource is unavailable.'));
    element.onerror = () => finish(new Error('Cannot load preview. Check the connection and retry.'));
    document.head.append(element);
  });
  scripts.set(source, task);
  task.catch(() => scripts.delete(source));
  return task;
}
function frameReady(frame) {
  if (frame.contentDocument?.getElementById('content')) return Promise.resolve();
  if (frames.has(frame)) return frames.get(frame);
  const task = new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer); frame.removeEventListener('load', loaded); frame.removeEventListener('error', failed);
      if (error) reject(error); else resolve();
    };
    const loaded = () => {
      if (frame.contentDocument?.getElementById('content')) finish();
    };
    const failed = () => finish(new Error('Cannot load article preview.'));
    const timer = setTimeout(() => finish(new Error('Preview timed out. Retry the preview.')), 20000);
    frame.addEventListener('load', loaded); frame.addEventListener('error', failed);
    frame.src = frame.dataset.src || frame.getAttribute('src') || 'preview.html?v=6';
  });
  frames.set(frame, task);
  task.catch(() => frames.delete(frame));
  return task;
}
export async function loadEditorResources() {
  await Promise.all([script('vendor/markdown-it.min.js', 'markdownit'), script('vendor/purify.min.js', 'DOMPurify'), script('vendor/katex/katex.min.js', 'katex')]);
}
export async function loadPreview(frame) {
  await Promise.all([loadEditorResources(), frameReady(frame)]);
}
