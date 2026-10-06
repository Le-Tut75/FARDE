import { S, calcSealed, addSealed, updateSealed, deleteSealed, searchSealed, priceHistory, sealedCatalogSize } from '../store.js';
import { getSets } from '../tcgdex.js';
import { norm } from '../match.js';
import { esc, eur, signEur, pct, plClass, langOptions, LANGS, openDialog, closeDialog, toast, num, today, lineChart, frDate, confirmButton, $ } from '../ui.js';

let root;
// Vocabulaire français -> noms de produits Cardmarket (en anglais)
const TYPES = [
  [/\b(coffret dresseur d ?elite|cde|etb)\b/g, 'Elite Trainer Box'], [/\bdisplays?\b/g, 'Booster Box'], [/\b(bundle|lot de 6 boosters|pack de 6)\b/g, 'Booster Bundle'],
  [/\b(tri ?pack|tripack)\b/g, 'Blister'], [/\bmini ?(tin|boite|pokebox)\b/g, 'Mini Tin'], [/\b(pokebox|boite metal|tin)\b/g, 'Tin'],
  [/\bcoffret premium\b/g, 'Premium Collection'], [/\bcoffret\b/g, 'Collection'], [/\bdeck de combat\b/g, 'Battle Deck'],
  [/\b(kit avant premiere|avant premiere)\b/g, 'Build Battle'], [/\bpieces?\b/g, 'Coin'],
];
let frToEn = null;
async function translations() {
  if (frToEn) return frToEn;
  frToEn = [];
  try {
    const [fr, en] = await Promise.all([getSets('fr'), getSets('en')]);
    const enById = new Map(en.map((s) => [s.id, s.name]));
    for (const s of fr) { const e = enById.get(s.id); if (e && norm(e) !== norm(s.name)) frToEn.push([norm(s.name), e]); }
    frToEn.sort((a, b) => b[0].length - a[0].length);
  } catch { /* hors ligne : pas de traduction */ }
  return frToEn;
}
/** "Display Flammes Fantasmagoriques" -> ["Phantasmal", "Flames", "Booster", "Box"] */
export async function sealedQueryWords(q) {
  let t = ` ${norm(q)} `;
  for (const [fr, en] of await translations()) if (t.includes(` ${fr} `)) t = t.replace(` ${fr} `, ` ${en} `);
  for (const [re, en] of TYPES) t = t.replace(re, en);
  return t.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && !['de', 'du', 'la', 'le', 'les', 'des', 'et', 'en'].includes(w.toLowerCase())).slice(0, 6);
}

export function render(el) {
  el.innerHTML = `<section class="view">
    <div class="vh"><div><h2>Produits scellés</h2><p>Displays, ETB, coffrets, blisters : cote Cardmarket mise à jour chaque matin.</p></div>
      <div class="row"><button class="btn" id="sCustom">Produit hors catalogue</button><button class="btn pri" id="sAdd">Ajouter un scellé</button></div></div>
    <div class="tw"><table class="resp nochk" id="sTable"><thead><tr>
      <th>Produit</th><th>Type</th><th>Lang.</th><th class="r">Qté</th><th class="r">Achat u.</th><th class="r">Cote u.</th><th class="r">Valeur</th><th class="r">P&amp;L</th>
    </tr></thead><tbody></tbody><tfoot></tfoot></table></div>
    <p class="note">La cote Cardmarket d’un produit scellé regroupe les langues européennes (les produits japonais, chinois et coréens ont leur propre fiche). Pour une cote différente, saisis une cote manuelle sur la ligne.</p>
  </section>`;
  root = el.firstElementChild;
  $('#sAdd', root).onclick = searchDialog;
  $('#sCustom', root).onclick = () => editDialog(null, null);
  $('#sTable tbody', root).addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) { const s = S.sealed.find((x) => x.id === tr.dataset.id); if (s) editDialog(s); } });
  update();
}

export function update() {
  if (!root?.isConnected) return;
  const tb = $('#sTable tbody', root);
  if (!S.sealed.length) {
    tb.innerHTML = `<tr><td colspan="8"><div class="empty">Aucun scellé. Clique sur « Ajouter un scellé » et cherche par exemple « ETB Flammes Fantasmagoriques ».</div></td></tr>`;
    $('#sTable tfoot', root).innerHTML = ''; return;
  }
  const rows = S.sealed.map((s) => ({ s, c: calcSealed(s) })).sort((a, b) => (b.c.value || 0) - (a.c.value || 0));
  tb.innerHTML = rows.map(({ s, c }) => `<tr data-id="${s.id}" style="cursor:pointer">
    <td class="c-main"><b>${esc(s.name)}</b>${s.notes ? `<div class="sub">${esc(s.notes)}</div>` : ''}${c.source === 'manuel' ? ' <span class="pill">cote manuelle</span>' : !s.cm_id ? ' <span class="pill al">sans cote auto</span>' : ''}</td>
    <td class="c-meta sub c-meta-sm">${esc(s.category || '')} · ${esc((s.lang || '').toUpperCase())} · ×${s.qty}${s.buy_price != null ? ' · achat ' + eur(s.buy_price) : ''}</td>
    <td class="hide-sm"><span class="pill">${esc(s.category || '—')}</span></td><td class="hide-sm">${esc((s.lang || '').toUpperCase())}</td>
    <td class="r num hide-sm">${s.qty}</td><td class="r num hide-sm">${eur(s.buy_price)}</td><td class="r num hide-sm">${eur(c.unit)}</td>
    <td class="r num c-val"><b>${eur(c.value)}</b></td><td class="r num c-pl ${plClass(c.pl)}">${c.pl != null ? signEur(c.pl) + `<div class="small">${c.invested ? pct((c.pl / c.invested) * 100) : ''}</div>` : '—'}</td></tr>`).join('');
  const v = rows.reduce((a, x) => a + (x.c.value || 0), 0), i = rows.reduce((a, x) => a + x.c.invested, 0);
  $('#sTable tfoot', root).innerHTML = `<tr><td>${rows.length} produit${rows.length > 1 ? 's' : ''}</td><td class="hide-sm"></td><td class="hide-sm"></td><td class="r num hide-sm">${rows.reduce((a, x) => a + x.s.qty, 0)}</td>
    <td class="r num hide-sm">${eur(i)}</td><td class="hide-sm"></td><td class="r num">${eur(v)}</td><td class="r num ${plClass(v - i)}">${signEur(v - i)}</td></tr>`;
}

async function searchDialog() {
  const d = openDialog(`<div class="mhead"><h3>Ajouter un scellé</h3><button class="btn sm" data-close aria-label="Fermer">✕</button></div>
    <div class="mbody"><form class="row" id="ssForm" style="flex-wrap:nowrap"><input type="search" id="ssQ" placeholder="ETB Flammes Fantasmagoriques, Display 151, Prismatic…" autocomplete="off"><button class="btn pri">Chercher</button></form>
    <p class="note" id="ssInfo">Le catalogue Cardmarket est en anglais : les noms de séries et de produits français sont traduits automatiquement.</p>
    <div id="ssRes"></div></div>`);
  $('#ssQ', d).focus();
  sealedCatalogSize().then((n) => { if (!n) $('#ssInfo', d).innerHTML = `<span class="warn">Le catalogue des scellés est vide : il se remplit à la première mise à jour automatique (Réglages › Mise à jour des cotes). En attendant, utilise « Produit hors catalogue ».</span>`; }).catch(() => {});
  let results = [];
  $('#ssForm', d).onsubmit = async (e) => {
    e.preventDefault();
    const q = $('#ssQ', d).value.trim(); if (!q) return;
    $('#ssRes', d).innerHTML = '<span class="spin"></span>';
    try {
      const words = await sealedQueryWords(q);
      results = await searchSealed(words);
      if (!results.length && words.length > 2) results = await searchSealed(words.slice(0, 2));
      $('#ssRes', d).innerHTML = results.length ? `<div class="toplist">${results.map((r, k) => `<div class="it" data-k="${k}" style="grid-template-columns:minmax(0,1fr) auto"><div style="min-width:0"><div class="ellip">${esc(r.name)}</div><div class="sub">${esc(r.category || '')}${r.avg30 ? ' · moy. 30 j ' + eur(r.avg30) : ''}</div></div><div class="num">${eur(r.trend)}</div></div>`).join('')}</div>`
        : `<div class="empty">Aucun produit trouvé pour « ${esc(words.join(' '))} ». Essaie le nom anglais de la série, ou ajoute-le comme produit hors catalogue.</div>`;
    } catch (x) { $('#ssRes', d).innerHTML = `<p class="loss">${esc(x.message)}</p>`; }
  };
  $('#ssRes', d).onclick = (e) => { const it = e.target.closest('[data-k]'); if (it) editDialog(null, results[+it.dataset.k]); };
}

function editDialog(s, cmRow) {
  const isNew = !s;
  const x = s || { name: cmRow?.name || '', category: cmRow?.category || '', cm_id: cmRow?.id ?? null, lang: S.settings.default_lang || 'fr', qty: 1, buy_price: null, buy_date: today(), manual_price: null, notes: '' };
  const auto = cmRow || (x.cm_id != null ? S.sealedPrices.get(Number(x.cm_id)) : null);
  const d = openDialog(`<div class="mhead"><h3>${isNew ? 'Ajouter' : 'Modifier'} : ${esc(x.name || 'produit hors catalogue')}</h3><button class="btn sm" data-close aria-label="Fermer">✕</button></div>
    <form class="mbody" id="sf">
      ${auto ? `<div class="prices"><div><span>Tendance</span><b>${eur(auto.trend)}</b></div><div><span>Moy. 30 j</span><b>${eur(auto.avg30)}</b></div><div><span>Moy. 7 j</span><b>${eur(auto.avg7)}</b></div><div><span>Plus bas</span><b>${eur(auto.low)}</b></div></div><div class="chart" id="sfChart"></div>` : ''}
      ${x.cm_id == null ? `<div class="fgrid"><div class="field" style="grid-column:span 2"><label for="sN">Produit</label><input id="sN" type="text" required value="${esc(x.name)}" placeholder="Display Flammes Fantasmagoriques"></div>
        <div class="field"><label for="sT">Type</label><input id="sT" type="text" value="${esc(x.category || '')}" placeholder="Display, ETB…"></div></div>` : ''}
      <div class="fgrid">
        <div class="field"><label for="sL">Langue</label><select id="sL">${langOptions(x.lang)}</select></div>
        <div class="field"><label for="sQ">Quantité</label><input id="sQ" type="number" min="1" max="9999" value="${x.qty}" required></div>
        <div class="field"><label for="sB">Achat unitaire (€)</label><input id="sB" type="number" min="0" step="0.01" inputmode="decimal" value="${x.buy_price ?? ''}"></div>
        <div class="field"><label for="sD">Date d'achat</label><input id="sD" type="date" value="${esc(x.buy_date || '')}"></div>
        <div class="field"><label for="sM">Cote manuelle u. (€)</label><input id="sM" type="number" min="0" step="0.01" inputmode="decimal" value="${x.manual_price ?? ''}" placeholder="${auto ? 'automatique' : 'à saisir'}"></div>
        <div class="field"><label for="sU">Lien (boutique, annonce)</label><input id="sU" type="url" value="${esc(x.url || '')}"></div>
      </div>
      <div class="field"><label for="sO">Notes</label><input id="sO" type="text" value="${esc(x.notes || '')}" placeholder="Acheté chez…"></div>
      <div class="row between"><div>${isNew ? '' : '<button type="button" class="btn dng" id="sDel">Supprimer</button>'}</div><div class="row"><button type="button" class="btn" data-close>Annuler</button><button class="btn pri" id="sSave">Enregistrer</button></div></div>
    </form>`);
  $('#sf', d).onsubmit = async (e) => {
    e.preventDefault();
    const data = { lang: $('#sL', d).value, qty: Math.max(1, parseInt($('#sQ', d).value, 10) || 1), buy_price: num($('#sB', d).value), buy_date: $('#sD', d).value || null,
      manual_price: num($('#sM', d).value), url: $('#sU', d).value.trim() || null, notes: $('#sO', d).value.trim() || null };
    if (x.cm_id == null) { data.name = $('#sN', d).value.trim(); data.category = $('#sT', d).value.trim() || null; }
    $('#sSave', d).disabled = true;
    try {
      if (isNew) await addSealed({ name: x.name, category: x.category || null, cm_id: x.cm_id, ...data }); else await updateSealed(s.id, data);
      closeDialog(); toast('Scellé enregistré.');
    } catch (err) { toast(err.message, 5000); $('#sSave', d).disabled = false; }
  };
  const del = $('#sDel', d);
  if (del) del.onclick = async () => { if (!confirmButton(del, 'Confirmer la suppression')) return; try { await deleteSealed(s.id); closeDialog(); toast('Scellé supprimé.'); } catch (err) { toast(err.message, 5000); } };
  if (auto && x.cm_id != null) priceHistory(`sealed:${x.cm_id}`).then((h) => {
    const el = $('#sfChart', d); if (!el) return;
    const svg = lineChart(h.map((r) => ({ d: r.d, v: r.trend })), [{ key: 'v', color: 'var(--accent)', area: true }], { height: 150, label: 'Historique de la cote' });
    el.innerHTML = svg ? `<div class="lbl">Cote tendance depuis le début du suivi</div>${svg}` : '<p class="note">L’historique se construit chaque matin tant que le produit est dans ta liste.</p>';
  }).catch(() => {});
}
