// Petits outils d'interface partagés par toutes les vues.

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtE = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const fmtU = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD' });
export const eur = (v) => (v == null || v === '' || isNaN(v) ? '—' : fmtE.format(Number(v)));
export const usd = (v) => (v == null || isNaN(v) ? '—' : fmtU.format(v));
export const signEur = (v) => (v == null ? '—' : (v > 0 ? '+' : '') + eur(v));
export const pct = (v) => (v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(1).replace('.', ',') + ' %');
export const plClass = (v) => (v > 0 ? 'gain' : v < 0 ? 'loss' : '');
export const today = () => new Date().toISOString().slice(0, 10);
export const frDate = (d, opts = { dateStyle: 'medium' }) => (d ? new Date(d).toLocaleDateString('fr-FR', opts) : '—');
export const frDateTime = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const num = (v) => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };

export const LANGS = { fr: 'Français', en: 'Anglais', ja: 'Japonais', de: 'Allemand', it: 'Italien', es: 'Espagnol' };
export const langOptions = (sel) => Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');

/** Image de carte TCGdex (qualité "low" ou "high"), avec repli si absente. */
export function cardImg(url, alt = '', cls = '', q = 'low') {
  if (!url) return `<div class="ph ${cls}">${esc(alt)}</div>`;
  return `<img class="${cls}" loading="lazy" decoding="async" src="${esc(url)}/${q}.webp" alt="${esc(alt)}" data-fallback="${esc(alt)}">`;
}
// Remplace toute image cassée par un cadre gris
document.addEventListener('error', (e) => {
  const t = e.target;
  if (t.tagName === 'IMG' && t.dataset.fallback != null && !t.dataset.failed) {
    t.dataset.failed = '1';
    const d = document.createElement('div');
    d.className = 'ph ' + (t.className || '');
    d.textContent = t.dataset.fallback;
    t.replaceWith(d);
  }
}, true);

let toastTimer;
export function toast(msg, ms = 3000) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// Dialogue modal unique
export const dlg = () => $('#dlg');
export function openDialog(html) {
  const d = dlg();
  d.innerHTML = html;
  if (!d.open) d.showModal();
  return d;
}
export function closeDialog() { const d = dlg(); if (d.open) d.close(); d.innerHTML = ''; }
document.addEventListener('click', (e) => {
  if (e.target === dlg()) closeDialog();
  if (e.target.closest('[data-close]')) closeDialog();
});

/** Bouton de suppression en deux temps (les boîtes confirm() natives sont bloquées dans certains contextes). */
export function confirmButton(btn, label = 'Confirmer', ms = 3500) {
  if (btn.dataset.armed) return true;
  const old = btn.textContent;
  btn.dataset.armed = '1';
  btn.textContent = label;
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = old; }, ms);
  return false;
}

/** Exécute fn sur chaque élément avec une concurrence limitée. */
export async function pool(items, n, fn, onProgress) {
  let i = 0, done = 0;
  const out = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const j = i++;
      try { out[j] = await fn(items[j], j); } catch (e) { out[j] = null; }
      done++; onProgress?.(done, items.length);
    }
  }));
  return out;
}

/** Téléchargement d'un fichier généré. */
export function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function toCsv(header, rows) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '﻿' + [header.map(q).join(';'), ...rows.map((r) => r.map(q).join(';'))].join('\r\n');
}
export const csvNum = (v) => (v == null ? '' : String(Number(v).toFixed(2)).replace('.', ','));

/**
 * Courbe SVG simple.
 * series : [{ key, color, dashed, area }] ; rows : [{ d, [key]: value }]
 */
export function lineChart(rows, series, { height = 230, label = 'Évolution' } = {}) {
  const pts = rows.filter((r) => series.some((s) => r[s.key] != null));
  if (pts.length < 2) return null;
  const W = 640, H = height, P = { l: 58, r: 14, t: 12, b: 28 };
  const vals = pts.flatMap((r) => series.map((s) => r[s.key]).filter((v) => v != null).map(Number));
  let mn = Math.min(...vals), mx = Math.max(...vals);
  if (mn === mx) { mn = mn * 0.9; mx = mx * 1.1 || 1; }
  const pad = (mx - mn) * 0.08; mn = Math.max(0, mn - pad); mx += pad;
  const t0 = new Date(pts[0].d).getTime(), t1 = new Date(pts.at(-1).d).getTime() || t0 + 1;
  const X = (d) => P.l + ((new Date(d).getTime() - t0) / Math.max(1, t1 - t0)) * (W - P.l - P.r);
  const Y = (v) => P.t + (1 - (v - mn) / (mx - mn)) * (H - P.t - P.b);
  const path = (k) => pts.filter((r) => r[k] != null).map((r, i) => `${i ? 'L' : 'M'}${X(r.d).toFixed(1)},${Y(Number(r[k])).toFixed(1)}`).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => mn + (mx - mn) * f);
  const fk = (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace('.', ',') + ' k€' : v >= 10 ? Math.round(v) + ' €' : v.toFixed(2).replace('.', ',') + ' €');
  const dl = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const id = 'g' + Math.random().toString(36).slice(2, 7);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>`;
  svg += ticks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${P.l - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono,monospace">${fk(v)}</text>`).join('');
  for (const s of series) {
    const p = path(s.key);
    if (!p) continue;
    if (s.area) { const f = pts.filter((r) => r[s.key] != null); svg += `<path d="${p}L${X(f.at(-1).d)},${H - P.b}L${X(f[0].d)},${H - P.b}Z" fill="url(#${id})"/>`; }
    svg += `<path d="${p}" fill="none" stroke="${s.color}" stroke-width="${s.dashed ? 1.5 : 2.2}" ${s.dashed ? 'stroke-dasharray="4 4"' : ''}/>`;
  }
  const main = series[0], last = [...pts].reverse().find((r) => r[main.key] != null);
  if (last) svg += `<circle cx="${X(last.d)}" cy="${Y(Number(last[main.key]))}" r="4.5" fill="${main.color}" stroke="var(--surface)" stroke-width="2"/>`;
  svg += `<text x="${P.l}" y="${H - 8}" font-size="11" fill="var(--muted)">${dl(pts[0].d)}</text><text x="${W - P.r}" y="${H - 8}" font-size="11" fill="var(--muted)" text-anchor="end">${dl(pts.at(-1).d)}</text></svg>`;
  return svg;
}
