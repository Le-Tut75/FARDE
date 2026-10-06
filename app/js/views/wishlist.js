import { S, wishPrice, updateWish, deleteWish } from '../store.js';
import { openCard } from '../carddialog.js';
import { VARIANTS } from '../valuation.js';
import { esc, eur, cardImg, num, toast, $ } from '../ui.js';

let root;
export function render(el) {
  el.innerHTML = `<section class="view">
    <div class="vh"><div><h2>Wishlist</h2><p>Fixe un prix cible : la carte passe en alerte quand sa cote descend dessous${S.settings.telegram_chat_id ? ', et tu reçois un message Telegram' : ''}.</p></div></div>
    <div class="cards" id="wGrid"></div>
  </section>`;
  root = el.firstElementChild;
  const g = $('#wGrid', root);
  g.addEventListener('change', async (e) => {
    const i = e.target.closest('[data-target]'); if (!i) return;
    try { await updateWish(i.dataset.target, { target_price: num(i.value), last_alert_at: null }); toast('Prix cible enregistré.'); } catch (x) { toast(x.message, 5000); }
  });
  g.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { try { await deleteWish(del.dataset.del); } catch (x) { toast(x.message, 5000); } return; }
    const o = e.target.closest('[data-open]');
    if (o) { const w = S.wish.find((x) => x.id === o.dataset.open); if (w) openCard(w.lang, w.card_id); }
  });
  update();
}

export function update() {
  if (!root?.isConnected) return;
  const g = $('#wGrid', root);
  if (!S.wish.length) { g.innerHTML = `<div class="empty" style="grid-column:1/-1">Ta wishlist est vide. Ouvre une carte dans le <a href="#catalogue">Catalogue</a> et clique sur « Ajouter à la wishlist ».</div>`; return; }
  const focused = document.activeElement?.dataset?.target;
  const list = [...S.wish].sort((a, b) => {
    const ha = a.target_price != null && wishPrice(a) != null && wishPrice(a) <= a.target_price, hb = b.target_price != null && wishPrice(b) != null && wishPrice(b) <= b.target_price;
    return hb - ha;
  });
  g.innerHTML = list.map((w) => {
    const p = wishPrice(w), hit = w.target_price != null && p != null && p <= Number(w.target_price);
    return `<div class="tile" style="cursor:default"><div class="img" role="button" tabindex="0" data-open="${w.id}" style="cursor:pointer">${cardImg(w.image, w.name)}${hit ? '<span class="badge ok">Prix atteint</span>' : ''}</div>
      <div class="t1 ellip">${esc(w.name)}</div><div class="t2"><span class="ellip">${esc(w.set_name || '')} · ${esc(w.lang.toUpperCase())}${w.variant !== 'normal' ? ' · ' + esc(VARIANTS[w.variant] || w.variant) : ''}</span></div>
      <div class="t2"><span>Cote</span><b class="num ${hit ? 'gain' : ''}">${eur(p)}</b></div>
      <div class="row" style="gap:6px;flex-wrap:nowrap"><input type="number" min="0" step="0.5" inputmode="decimal" id="wt-${w.id}" data-target="${w.id}" value="${w.target_price ?? ''}" placeholder="Prix cible €" aria-label="Prix cible pour ${esc(w.name)}" style="padding:5px 8px">
      <button class="btn sm" data-del="${w.id}" aria-label="Retirer ${esc(w.name)}">✕</button></div></div>`;
  }).join('');
  if (focused) document.getElementById('wt-' + focused)?.focus();
}
