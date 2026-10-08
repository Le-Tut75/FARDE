// Recherche globale : ta collection, ta wishlist, tes scellés, le catalogue des cartes et des produits scellés.
import { S, searchSealed, calcLine } from './store.js';
import { searchAny } from './tcgdex.js';
import { openCard } from './carddialog.js';
import { norm } from './match.js';
import { esc, eur, cardImg, openDialog, closeDialog, $ } from './ui.js';

let seq = 0, timer;

export function openSearch() {
  const d = openDialog(`<div class="gs">
    <div class="gs-head"><svg><use href="#i-search"/></svg><input id="gsQ" type="search" placeholder="Une carte, une série, un produit scellé…" aria-label="Rechercher" autocomplete="off"><button class="btn sm" data-close aria-label="Fermer">Échap</button></div>
    <div class="gs-body" id="gsBody"><p class="note" style="padding:6px 4px">Cherche dans ta collection, ta wishlist, tes scellés et dans tout le catalogue. Astuce : touche « / » pour ouvrir la recherche.</p></div>
  </div>`);
  d.classList.add('dlg-search');
  const inp = $('#gsQ', d);
  inp.focus();
  inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => run(inp.value.trim()), 220); });
  inp.addEventListener('keydown', (e) => {
    const items = [...d.querySelectorAll('.gs-it')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); items[0].focus(); }
    if (e.key === 'Enter' && items.length) { e.preventDefault(); items[0].click(); }
    if (i < -1) return;
  });
  d.addEventListener('keydown', (e) => {
    if (!e.target.classList?.contains('gs-it')) return;
    const items = [...d.querySelectorAll('.gs-it')], i = items.indexOf(e.target);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, i + 1)].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (i === 0 ? inp : items[i - 1]).focus(); }
  });
  d.addEventListener('click', onClick);
  d.addEventListener('close', () => { d.classList.remove('dlg-search'); d.removeEventListener('click', onClick); }, { once: true });
}

let lastRes = {};
function onClick(e) {
  const it = e.target.closest('.gs-it'); if (!it) return;
  const { kind, i } = it.dataset, x = lastRes[kind]?.[+i];
  if (!x) return;
  if (kind === 'own') { openCard(x.lang, x.card_id, { line: x }); return; }
  if (kind === 'wish') { closeDialog(); location.hash = '#wishlist'; return; }
  if (kind === 'cat') { openCard(x.lang, x.id); return; }
  if (kind === 'sown' || kind === 'scat') goSealed(kind === 'sown' ? [x] : [null, x]);
}
/** Ouvre la page Scellés puis la fiche du produit. */
async function goSealed(args) {
  const m = await import('./views/sealed.js');
  closeDialog();
  if (location.hash.startsWith('#scelles')) { m.openSealed(...args); return; }
  window.addEventListener('hashchange', () => setTimeout(() => m.openSealed(...args), 0), { once: true });
  location.hash = '#scelles';
}

async function run(q) {
  const body = $('#gsBody');
  if (!body) return;
  const my = ++seq;
  if (q.length < 2) { body.innerHTML = '<p class="note" style="padding:6px 4px">Tape au moins 2 lettres.</p>'; return; }
  const nq = norm(q), words = nq.split(' ').filter(Boolean);
  const has = (txt) => { const t = norm(txt); return words.every((w) => t.includes(w)); };
  lastRes = {
    own: S.cards.filter((l) => has(`${l.name} ${l.set_name} ${l.local_id} ${l.notes || ''}`)).sort((a, b) => (calcLine(b).value || 0) - (calcLine(a).value || 0)).slice(0, 8),
    wish: S.wish.filter((w) => has(`${w.name} ${w.set_name}`)).slice(0, 4),
    sown: S.sealed.filter((s) => has(`${s.name} ${s.category}`)).slice(0, 4),
    cat: [], scat: [],
  };
  draw(body, true);
  const lang = S.settings.default_lang || 'fr';
  const [cat, scat] = await Promise.all([
    searchAny('all', { q, mode: 'name' }, lang).catch(() => []),
    S.offline ? [] : searchSealed({ words: q.split(/\s+/).filter((w) => w.length > 1).slice(0, 4), limit: 6, withImage: false }).catch(() => []),
  ]);
  if (my !== seq || !$('#gsBody')) return;
  lastRes.cat = cat.slice(0, 12); lastRes.scat = scat.slice(0, 6);
  draw(body, false);
}

function draw(body, loading) {
  const sec = (title, kind, rows, render) => rows.length ? `<div class="gs-sec"><div class="gs-t">${title}</div>${rows.map((x, i) => `<button type="button" class="gs-it" data-kind="${kind}" data-i="${i}">${render(x)}</button>`).join('')}</div>` : '';
  const sImg = (url, alt) => (url ? `<span class="simg sthumb"><img src="${esc(url)}" alt="${esc(alt)}" loading="lazy"></span>` : '<span class="simg sthumb"><span class="ph"></span></span>');
  const html = sec('Ma collection', 'own', lastRes.own, (l) => `${cardImg(l.image, l.name, 'thumb')}<span class="gs-m"><b class="ellip">${esc(l.name)} <span class="muted">${esc(l.local_id || '')}</span></b><span class="muted small ellip">${esc(l.set_name || '')} · ${esc(l.lang.toUpperCase())} · ×${l.qty}</span></span><span class="num">${eur(calcLine(l).value)}</span>`)
    + sec('Wishlist', 'wish', lastRes.wish, (w) => `${cardImg(w.image, w.name, 'thumb')}<span class="gs-m"><b class="ellip">${esc(w.name)}</b><span class="muted small ellip">${esc(w.set_name || '')}</span></span>`)
    + sec('Mes scellés', 'sown', lastRes.sown, (s) => `${sImg(s.image_url || S.sealedPrices.get(Number(s.cm_id))?.image, s.name)}<span class="gs-m"><b class="ellip">${esc(s.name)}</b><span class="muted small">${esc(s.category || '')} · ×${s.qty}</span></span>`)
    + sec('Catalogue des cartes', 'cat', lastRes.cat, (c) => `${cardImg(c.image, c.name, 'thumb')}<span class="gs-m"><b class="ellip">${esc(c.name)} <span class="muted">${esc(c.localId || '')}</span></b><span class="muted small ellip">${esc(String(c.id).replace(/-[^-]+$/, ''))} · ${esc(c.lang.toUpperCase())}</span></span>`)
    + sec('Produits scellés', 'scat', lastRes.scat, (p) => `${sImg(p.image, p.name)}<span class="gs-m"><b class="ellip">${esc(p.name)}</b><span class="muted small">${esc(p.category || '')}</span></span><span class="num">${eur(p.trend)}</span>`);
  body.innerHTML = html + (loading ? '<div class="gs-sec"><span class="spin"></span> <span class="muted small">Recherche dans le catalogue…</span></div>' : html ? '' : '<p class="note" style="padding:6px 4px">Aucun résultat.</p>');
}
