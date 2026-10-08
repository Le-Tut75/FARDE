import { S, calcSealed, addSealed, updateSealed, deleteSealed, searchSealed, priceHistory, sealedCatalogSize } from '../store.js';
import { getSets, getSetsNewestFirst, getSeriesGroups } from '../tcgdex.js';
import { norm } from '../match.js';
import { openSell } from '../sell.js';
import { esc, eur, signEur, pct, plClass, langOptions, openDialog, closeDialog, toast, num, today, lineChart, confirmButton, setPicker, $ } from '../ui.js';

let root;

// Types de produits -> catégories Cardmarket (+ motif sur le nom)
export const TYPES = [
  ['', 'Tous les types'],
  ['etb', 'ETB (coffret dresseur d’élite)', [1016]],
  ['display', 'Display (boîte de boosters)', [53], '%Booster Box%'],
  ['bundle', 'Bundle (6 boosters)', [53], '%Bundle%'],
  ['booster', 'Booster à l’unité', [52]],
  ['blister', 'Blister / tripack', [1083]],
  ['coffret', 'Coffret / collection', [1015, 1013]],
  ['tin', 'Pokébox / tin', [1014]],
  ['deck', 'Deck', [54]],
  ['set', 'Set complet', [1064, 1654]],
];

// Vocabulaire français -> noms de produits Cardmarket (en anglais)
const VOCAB = [
  [/\b(coffret dresseur d ?elite|cde|etb)\b/g, 'Elite Trainer Box'], [/\bdisplays?\b/g, 'Booster Box'], [/\b(bundle|lot de 6 boosters|pack de 6)\b/g, 'Booster Bundle'],
  [/\b(tri ?pack|tripack)\b/g, 'Blister'], [/\bmini ?(tin|boite|pokebox)\b/g, 'Mini Tin'], [/\b(pokebox|boite metal|tin)\b/g, 'Tin'],
  [/\bcoffret premium\b/g, 'Premium Collection'], [/\bcoffret\b/g, 'Collection'], [/\bdeck de combat\b/g, 'Battle Deck'],
  [/\b(kit avant premiere|avant premiere)\b/g, 'Build Battle'], [/\bpieces?\b/g, 'Coin'],
];
let frToEn = null, enById = null;
async function translations() {
  if (frToEn) return frToEn;
  frToEn = []; enById = new Map();
  try {
    const [fr, en] = await Promise.all([getSets('fr'), getSets('en')]);
    for (const s of en) enById.set(s.id, s.name);
    for (const s of fr) { const e = enById.get(s.id); if (e && norm(e) !== norm(s.name)) frToEn.push([norm(s.name), e]); }
    frToEn.sort((a, b) => b[0].length - a[0].length);
  } catch { /* hors ligne : pas de traduction */ }
  return frToEn;
}
const toWords = (t) => t.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && !['de', 'du', 'la', 'le', 'les', 'des', 'et', 'en', 'and'].includes(w.toLowerCase()));
/** "Display Flammes Fantasmagoriques" -> ["Booster", "Box", "Phantasmal", "Flames"] */
export async function sealedQueryWords(q) {
  let t = ` ${norm(q)} `;
  for (const [fr, en] of await translations()) if (t.includes(` ${fr} `)) t = t.replace(` ${fr} `, ` ${en} `);
  for (const [re, en] of VOCAB) t = t.replace(re, en);
  return toWords(t).slice(0, 6);
}

/** Photo d'un scellé : la tienne si tu en as mis une, sinon celle du catalogue. */
export const sealedImage = (s) => s.image_url || (s.cm_id != null ? S.sealedPrices.get(Number(s.cm_id))?.image : null) || s.image || null;
export function sealedImg(url, alt = '', cls = '') {
  return `<div class="simg ${cls}">${url ? `<img loading="lazy" src="${esc(url)}" alt="${esc(alt)}" referrerpolicy="no-referrer" data-fallback="${esc(alt)}">` : `<div class="ph">${esc(alt.split(' ').slice(-3).join(' '))}</div>`}</div>`;
}

const st = { q: '', type: '', set: null, order: '', seq: 0, results: [] };

export function render(el) {
  el.innerHTML = `<section class="view">
    <div class="vh"><div><h2>Produits scellés</h2><p>Displays, ETB, coffrets, blisters : cote Cardmarket mise à jour chaque matin.</p></div>
      <div class="row"><button class="btn" id="sCustom">Produit hors catalogue</button><a class="btn pri" href="#sCat" id="sAddJump">Ajouter un scellé</a></div></div>
    <div class="tw"><table class="resp nochk" id="sTable"><thead><tr>
      <th></th><th>Produit</th><th>Type</th><th>Lang.</th><th class="r">Qté</th><th class="r">Achat u.</th><th class="r">Cote u.</th><th class="r">Valeur</th><th class="r">P&amp;L</th>
    </tr></thead><tbody></tbody><tfoot></tfoot></table></div>

    <div class="panel stack" id="sCat">
      <div class="row between"><h3>Catalogue des scellés</h3><span class="muted small" id="sCount"></span></div>
      <div class="filters">
        <div class="field q"><label for="sQ">Recherche</label><input id="sQ" type="search" placeholder="ETB Flammes Fantasmagoriques, display 151…" value="${esc(st.q)}" autocomplete="off" enterkeyhint="search"></div>
        <div class="field"><label for="sType">Type</label><select id="sType">${TYPES.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
        <div class="field"><label for="sSet">Série</label><input id="sSet" type="text" value="${esc(st.set?.name || '')}"></div>
      </div>
      <div class="row between"><span class="muted small" id="sInfo"></span>
        <label class="row small" style="gap:6px">Tri <select id="sOrder" style="width:auto"><option value="">Pertinence</option><option value="new">Nouveautés</option><option value="price_desc">Prix décroissant</option><option value="price_asc">Prix croissant</option></select></label></div>
      <div class="sgrid" id="sRes"></div>
    </div>
    <p class="note">La cote Cardmarket d’un produit scellé regroupe les langues européennes (les produits japonais, chinois et coréens ont leur propre fiche). Pour une cote différente, saisis une cote manuelle. Photos : catalogue TCGplayer, rapprochées automatiquement.</p>
  </section>`;
  root = el.firstElementChild;
  $('#sType', root).value = st.type; $('#sOrder', root).value = st.order;
  $('#sCustom', root).onclick = () => editDialog(null, null);
  $('#sAddJump', root).onclick = (e) => { e.preventDefault(); $('#sCat', root).scrollIntoView({ behavior: 'smooth' }); $('#sQ', root).focus({ preventScroll: true }); };
  $('#sTable tbody', root).addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) { const s = S.sealed.find((x) => x.id === tr.dataset.id); if (s) editDialog(s); } });
  let t;
  $('#sQ', root).addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { st.q = $('#sQ', root).value.trim(); browse(); }, 300); });
  $('#sQ', root).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); st.q = e.target.value.trim(); browse(); } });
  $('#sType', root).onchange = (e) => { st.type = e.target.value; browse(); };
  $('#sOrder', root).onchange = (e) => { st.order = e.target.value; browse(); };
  setPicker($('#sSet', root), () => getSeriesGroups('fr'), (s) => { st.set = s; browse(); });
  $('#sRes', root).addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) editDialog(null, st.results[+b.dataset.k]); });
  sealedCatalogSize().then((n) => { const c = $('#sCount', root); if (c) c.textContent = n ? `${n.toLocaleString('fr-FR')} produits` : ''; if (!n) $('#sInfo', root).innerHTML = '<span class="warn">Le catalogue se remplit à la première mise à jour automatique (Réglages › Mise à jour des cotes). En attendant, utilise « Produit hors catalogue ».</span>'; }).catch(() => {});
  update();
  browse();
}

async function browse() {
  if (!root?.isConnected) return;
  const my = ++st.seq;
  const res = $('#sRes', root), info = $('#sInfo', root);
  res.innerHTML = '<span class="spin"></span>';
  try {
    const words = st.q ? await sealedQueryWords(st.q) : [];
    if (st.set) { await translations(); words.push(...toWords(enById.get(st.set.id) || st.set.name)); }
    const ty = TYPES.find((x) => x[0] === st.type) || [];
    let order = st.order || (st.q ? 'relevance' : 'new');
    // Sans aucun filtre : on ouvre sur les vrais produits récents (ETB, displays, bundles, coffrets) avec photo
    const idle = !st.q && !st.set && !st.type;
    let rows = await searchSealed({ words, cats: idle ? [1016, 53, 1015, 1014] : (ty[2] || null), like: ty[3] || null, order, withImage: idle });
    if (idle && !rows.length) rows = await searchSealed({ order });
    if (!rows.length && words.length > 2 && st.q) rows = await searchSealed({ words: words.slice(0, 2), cats: ty[2] || null, like: ty[3] || null, order });
    if (my !== st.seq) return;
    st.results = rows;
    const what = [st.q && `« ${st.q} »`, st.set?.name, ty[1] && st.type ? ty[1].split(' (')[0] : null].filter(Boolean).join(' · ');
    info.textContent = rows.length ? `${rows.length >= 60 ? '60 premiers résultats' : rows.length + ' produit' + (rows.length > 1 ? 's' : '')}${what ? ' · ' + what : ' · nouveautés'}` : '';
    res.innerHTML = rows.length ? rows.map((r, k) => `<button class="stile" data-k="${k}" title="${esc(r.name)}">${sealedImg(r.image, r.name)}
        <div class="t1">${esc(r.name)}</div><div class="t2"><span class="ellip">${esc(r.category || '')}</span><b class="num">${eur(r.trend)}</b></div></button>`).join('')
      : `<div class="empty" style="grid-column:1/-1">Aucun produit trouvé${what ? ' pour ' + esc(what) : ''}. Essaie moins de mots, un autre type, ou le nom anglais de la série.</div>`;
  } catch (e) { if (my === st.seq) res.innerHTML = `<p class="loss">${esc(e.message)}</p>`; }
}

export function update() {
  if (!root?.isConnected) return;
  const tb = $('#sTable tbody', root);
  if (!S.sealed.length) {
    tb.innerHTML = `<tr><td colspan="9"><div class="empty">Aucun scellé dans ta collection. Cherche un produit dans le catalogue ci-dessous et clique dessus pour l’ajouter.</div></td></tr>`;
    $('#sTable tfoot', root).innerHTML = ''; return;
  }
  const rows = S.sealed.map((s) => ({ s, c: calcSealed(s) })).sort((a, b) => (b.c.value || 0) - (a.c.value || 0));
  tb.innerHTML = rows.map(({ s, c }) => `<tr data-id="${s.id}" style="cursor:pointer">
    <td class="c-img">${sealedImg(sealedImage(s), s.name, 'sthumb')}</td>
    <td class="c-main"><b>${esc(s.name)}</b>${s.notes ? `<div class="sub">${esc(s.notes)}</div>` : ''}${c.source === 'manuel' ? ' <span class="pill">cote manuelle</span>' : !s.cm_id ? ' <span class="pill al">sans cote auto</span>' : ''}</td>
    <td class="c-meta sub c-meta-sm">${esc(s.category || '')} · ${esc((s.lang || '').toUpperCase())} · ×${s.qty}${s.buy_price != null ? ' · achat ' + eur(s.buy_price) : ''}</td>
    <td class="hide-sm"><span class="pill">${esc(s.category || '—')}</span></td><td class="hide-sm">${esc((s.lang || '').toUpperCase())}</td>
    <td class="r num hide-sm">${s.qty}</td><td class="r num hide-sm">${eur(s.buy_price)}</td><td class="r num hide-sm">${eur(c.unit)}</td>
    <td class="r num c-val"><b>${eur(c.value)}</b></td><td class="r num c-pl ${plClass(c.pl)}">${c.pl != null ? signEur(c.pl) + `<div class="small">${c.invested ? pct((c.pl / c.invested) * 100) : ''}</div>` : '—'}</td></tr>`).join('');
  const v = rows.reduce((a, x) => a + (x.c.value || 0), 0), i = rows.reduce((a, x) => a + x.c.invested, 0);
  $('#sTable tfoot', root).innerHTML = `<tr><td class="hide-sm"></td><td>${rows.length} produit${rows.length > 1 ? 's' : ''}</td><td class="hide-sm"></td><td class="hide-sm"></td><td class="r num hide-sm">${rows.reduce((a, x) => a + x.s.qty, 0)}</td>
    <td class="r num hide-sm">${eur(i)}</td><td class="hide-sm"></td><td class="r num">${eur(v)}</td><td class="r num ${plClass(v - i)}">${signEur(v - i)}</td></tr>`;
}

export const openSealed = (s, cmRow) => editDialog(s, cmRow);
function editDialog(s, cmRow) {
  const isNew = !s;
  const x = s || { name: cmRow?.name || '', category: cmRow?.category || '', cm_id: cmRow?.id ?? null, lang: S.settings.default_lang || 'fr', qty: 1, buy_price: null, buy_date: today(), manual_price: null, notes: '', image_url: null };
  const auto = cmRow || (x.cm_id != null ? S.sealedPrices.get(Number(x.cm_id)) : null);
  const img = x.image_url || auto?.image || null;
  const d = openDialog(`<div class="mhead"><h3>${isNew ? 'Ajouter' : 'Modifier'} : ${esc(x.name || 'produit hors catalogue')}</h3><button class="btn sm" data-close aria-label="Fermer">✕</button></div>
    <form class="mbody" id="sf">
      <div class="row" style="align-items:flex-start;flex-wrap:nowrap;gap:16px">
        <div style="width:120px;flex:none">${sealedImg(img, x.name)}</div>
        <div class="stack" style="flex:1;min-width:0">
          ${auto ? `<div class="prices"><div><span>Tendance</span><b>${eur(auto.trend)}</b></div><div><span>Moy. 30 j</span><b>${eur(auto.avg30)}</b></div><div><span>Moy. 7 j</span><b>${eur(auto.avg7)}</b></div><div><span>Plus bas</span><b>${eur(auto.low)}</b></div></div>` : '<p class="note">Produit sans cote automatique : saisis une cote manuelle.</p>'}
          ${auto ? `<a class="small" href="https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(x.name)}" target="_blank" rel="noopener">Voir sur Cardmarket</a>` : ''}
        </div>
      </div>
      ${auto ? '<div class="chart" id="sfChart"></div>' : ''}
      ${x.cm_id == null ? `<div class="fgrid"><div class="field" style="grid-column:span 2"><label for="sN">Produit</label><input id="sN" type="text" required value="${esc(x.name)}" placeholder="Display Flammes Fantasmagoriques"></div>
        <div class="field"><label for="sT">Type</label><input id="sT" type="text" value="${esc(x.category || '')}" placeholder="Display, ETB…"></div></div>` : ''}
      <div class="fgrid">
        <div class="field"><label for="sL">Langue</label><select id="sL">${langOptions(x.lang)}</select></div>
        <div class="field"><label for="sQty">Quantité</label><input id="sQty" type="number" min="1" max="9999" value="${x.qty}" required></div>
        <div class="field"><label for="sB">Achat unitaire (€)</label><input id="sB" type="number" min="0" step="0.01" inputmode="decimal" value="${x.buy_price ?? ''}"></div>
        <div class="field"><label for="sD">Date d'achat</label><input id="sD" type="date" value="${esc(x.buy_date || '')}"></div>
        <div class="field"><label for="sM">Cote manuelle u. (€)</label><input id="sM" type="number" min="0" step="0.01" inputmode="decimal" value="${x.manual_price ?? ''}" placeholder="${auto ? 'automatique' : 'à saisir'}"></div>
        <div class="field"><label for="sU">Lien (boutique, annonce)</label><input id="sU" type="url" value="${esc(x.url || '')}"></div>
      </div>
      <div class="field"><label for="sImg">Ta propre photo (lien d’image, facultatif)</label><input id="sImg" type="url" value="${esc(x.image_url || '')}" placeholder="https://… .jpg — remplace la photo automatique"></div>
      <div class="field"><label for="sO">Notes</label><input id="sO" type="text" value="${esc(x.notes || '')}" placeholder="Acheté chez…"></div>
      <div class="row between"><div class="row">${isNew ? '' : '<button type="button" class="btn dng" id="sDel">Supprimer</button><button type="button" class="btn" id="sSell">Vendre</button>'}</div><div class="row"><button type="button" class="btn" data-close>Annuler</button><button class="btn pri" id="sSave">${isNew ? 'Ajouter à ma collection' : 'Enregistrer'}</button></div></div>
    </form>`);
  $('#sf', d).onsubmit = async (e) => {
    e.preventDefault();
    const imgUrl = $('#sImg', d).value.trim();
    const data = { lang: $('#sL', d).value, qty: Math.max(1, parseInt($('#sQty', d).value, 10) || 1), buy_price: num($('#sB', d).value), buy_date: $('#sD', d).value || null,
      manual_price: num($('#sM', d).value), url: $('#sU', d).value.trim() || null, notes: $('#sO', d).value.trim() || null, image_url: /^https:\/\//.test(imgUrl) ? imgUrl : null };
    if (x.cm_id == null) { data.name = $('#sN', d).value.trim(); data.category = $('#sT', d).value.trim() || null; }
    $('#sSave', d).disabled = true;
    try {
      if (isNew) await addSealed({ name: x.name, category: x.category || null, cm_id: x.cm_id, ...data }); else await updateSealed(s.id, data);
      closeDialog(); toast(isNew ? 'Scellé ajouté à ta collection.' : 'Scellé enregistré.');
    } catch (err) { toast(err.message, 5000); $('#sSave', d).disabled = false; }
  };
  const sell = $('#sSell', d);
  if (sell) sell.onclick = () => openSell('sealed', s);
  const del = $('#sDel', d);
  if (del) del.onclick = async () => { if (!confirmButton(del, 'Confirmer la suppression')) return; try { await deleteSealed(s.id); closeDialog(); toast('Scellé supprimé.'); } catch (err) { toast(err.message, 5000); } };
  if (auto && x.cm_id != null) priceHistory(`sealed:${x.cm_id}`).then((h) => {
    const el = $('#sfChart', d); if (!el) return;
    const svg = lineChart(h.map((r) => ({ d: r.d, v: r.trend })), [{ key: 'v', color: 'var(--accent)', area: true }], { height: 150, label: 'Historique de la cote' });
    el.innerHTML = svg ? `<div class="lbl">Cote tendance depuis le début du suivi</div>${svg}` : '<p class="note">L’historique se construit chaque matin tant que le produit est dans ta collection.</p>';
  }).catch(() => {});
}
