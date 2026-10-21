/* Ink absorbs into paper in uneven layers; no continuous rendering loop. */
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const active = new Set();
  let press;
  const clear = () => { active.forEach(node => node.remove()); active.clear(); press = undefined; };
  reduced.addEventListener('change', clear);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });

  function bloom(x, y) {
    if (active.size >= 4) { const oldest = active.values().next().value; oldest.remove(); active.delete(oldest); }
    const node = document.createElement('span');
    node.className = 'ink-click'; node.setAttribute('aria-hidden', 'true');
    node.style.left = `${x}px`; node.style.top = `${y}px`;
    node.style.setProperty('--ink-angle', `${Math.random() * 360}deg`);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dark = document.documentElement.dataset.theme === 'dark';
    const ink = dark ? '191, 195, 176' : '43, 48, 40';
    const phase = Array.from({ length: 5 }, () => Math.random() * Math.PI * 2);
    // Related contours keep a coherent stain while varying its capillary edge.
    for (let layer = 0; layer < 5; layer++) {
      const radius = 92 - layer * 10;
      const wash = ctx.createRadialGradient(120, 120, 2, 120, 120, radius * 1.18);
      wash.addColorStop(0, `rgba(${ink}, ${0.21 + layer * 0.025})`);
      wash.addColorStop(0.48, `rgba(${ink}, 0.14)`);
      wash.addColorStop(0.82, `rgba(${ink}, 0.055)`);
      wash.addColorStop(1, `rgba(${ink}, 0)`);
      ctx.fillStyle = wash; ctx.beginPath();
      for (let i = 0; i <= 180; i++) {
        const angle = i / 180 * Math.PI * 2;
        const edge = 1 + 0.09 * Math.sin(3 * angle + phase[0]) + 0.07 * Math.sin(5 * angle + phase[1])
          + 0.045 * Math.sin(9 * angle + phase[2]) + 0.025 * Math.sin(19 * angle + phase[3] + layer * 0.4)
          + 0.018 * Math.sin(37 * angle + phase[4]);
        const px = 120 + Math.cos(angle) * radius * edge;
        const py = 120 + Math.sin(angle) * radius * edge * 0.9;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
    }
    // Sparse pigment granules remain inside the spreading wash, rather than flying out.
    for (let i = 0; i < 90; i++) {
      const angle = Math.random() * Math.PI * 2, distance = Math.sqrt(Math.random()) * 65;
      ctx.fillStyle = `rgba(${ink}, ${0.025 + Math.random() * 0.055})`;
      ctx.beginPath(); ctx.arc(120 + Math.cos(angle) * distance, 120 + Math.sin(angle) * distance * 0.9,
        0.3 + Math.random() * 1.1, 0, Math.PI * 2); ctx.fill();
    }
    node.append(canvas); document.body.append(node); active.add(node);
    const remove = () => { node.remove(); active.delete(node); };
    canvas.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 1600);
  }
  document.addEventListener('pointerdown', event => {
    press = undefined;
    if (!event.isPrimary || event.button !== 0 || reduced.matches || document.hidden ||
      event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }, { passive: true });
  document.addEventListener('pointermove', event => {
    if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12) press = undefined;
  }, { passive: true });
  document.addEventListener('pointerup', event => {
    const start = press; press = undefined;
    if (!start || start.id !== event.pointerId || reduced.matches || document.hidden ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) return;
    bloom(event.clientX, event.clientY);
  }, { passive: true });
  document.addEventListener('pointercancel', () => { press = undefined; }, { passive: true });
  window.addEventListener('pagehide', clear);
})();
