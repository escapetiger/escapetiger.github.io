// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
export const MAX_IMAGES = 8, MAX_IMAGE_BYTES = 3 * 1024 * 1024, MAX_TOTAL_BYTES = 12 * 1024 * 1024;
export function imageKind(bytes) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if ([137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value)) return 'image/png';
  if (String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP') return 'image/webp';
  return null;
}
export async function prepareImage(file) {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('imageSize');
  const type = imageKind(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!type) throw new Error('imageType');
  const url = URL.createObjectURL(file), image = new Image();
  let blob;
  try {
    image.src = url; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 60000000) throw new Error('imageSize');
    const scale = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d'); if (!context) throw new Error('imageDecode');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    blob = await new Promise(resolve => canvas.toBlob(resolve, type, .85));
    canvas.width = canvas.height = 0;
    if (!blob || blob.size > MAX_IMAGE_BYTES) throw new Error('imageSize');
  } catch (error) { throw new Error(['imageSize', 'imageType'].includes(error.message) ? error.message : 'imageDecode'); }
  finally { URL.revokeObjectURL(url); }
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[blob.type];
  if (!extension) throw new Error('imageType');
  const path = `static/images/blog/${crypto.randomUUID()}.${extension}`;
  return { path, url: '/' + path.slice(7), blob, name: file.name || `image.${extension}`, uploaded: false, persisted: false };
}
export async function encodedImage(asset) {
  const bytes = new Uint8Array(await asset.blob.arrayBuffer()); let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return { path: asset.path, content: btoa(binary) };
}
export function insertMarkup(text, start, end, kind) {
  const selected = text.slice(start, end);
  const choices = { heading: ['## ', ''], bold: ['**', '**'], link: ['[', '](https://example.com)'], list: ['- ', ''], math: ['\\(', '\\)'] };
  const [before, after] = choices[kind] || ['', ''];
  if (kind === 'heading' || kind === 'list') {
    const from = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
    const region = text.slice(from, end);
    const inserted = before + region.replace(/\n(?=.)/g, '\n' + before);
    return { text: text.slice(0, from) + inserted + text.slice(end), start: start + before.length, end: end + inserted.length - region.length };
  }
  const insert = before + selected + after;
  return { text: text.slice(0, start) + insert + text.slice(end), start: start + before.length, end: start + before.length + selected.length };
}
