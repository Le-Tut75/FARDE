import { S, ownedQty } from '../store.js';
import { getSets, getCard, searchAny, groupsFor, LANG_ORDER, isPromoSet, promoSets } from '../tcgdex.js';
import { cmPrice } from '../valuation.js';
import { norm, setIdOf } from '../match.js';
import { openCard } from '../carddialog.js';
import { esc, eur, cardImg, LANGS, pool, combo, setPicker, $ } from '../ui.js';
import { plusBtn, quickAddCard, bindPlus } from '../quick.js';

const PER = 24;
const MAX_DETAILS = 400;   // au-delà, on demande d'affiner avant de charger raretés et cotes
const st = { q: '', mode: 'name', lang: 'all', set: null, sort: 'def', rarity: '', promo: '', exact: false, page: 1, list: [], details: new Map(), seq: 0, loading: false };
let root;

const dkey = (it) => `${it.lang}:${it.id}`;
const langOpts = (sel) => `<option value="all" ${sel === 'all' ? 'selected' : ''}>Toutes les langues</option>` + LANG_ORDER.map((k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${LANGS[k]}</option>`).join('');

export function render(el) {
  el.innerHTML = `<section class="view">
    <div class="vh"><div><h2>Catalogue</h2><p>Toutes les cartes Pokémon, dans toutes les langues, avec leur cote. Le « + » d’une carte l’ajoute à ta collection.</p></div></div>
    <form class="panel search" id="cForm">
      <div class="field q"><label for="cQ">Recherche</label><input id="cQ" type="search" placeholder="Dracaufeu, Charizard, 199, Mitsuhiro Arita…" value="${esc(st.q)}" enterkeyhint="search"></div>
      <div class="field"><label for="cMode">Par</label><select id="cMode"><option value="name">Nom</option><option value="num">Numéro</option><option value="illu">Illustrateur</option></select></div>
      <div class="field"><label for="cLang">Langue</label><select id="cLang">${langOpts(st.lang)}</select></div>
      <div class="field"><label for="cSet">Série</label><input id="cSet" type="text" value="${esc(st.set?.name || '')}"></div>
      <div class="field"><label for="cSort">Tri</label><select id="cSort"><option value="def">Numéro</option><option value="price">Prix décroissant</option><option value="price_asc">Prix croissant</option><option value="name">Nom</option></select></div>
      <div class="field"><label>&nbsp;</label><button class="btn pri" type="submit">Chercher</button></div>
    </form>
    <div class="row between">
      <div class="row"><label class="row small" style="gap:6px"><input type="checkbox" id="cExact" ${st.exact ? 'checked' : ''}> Nom exact</label>
        <label class="row small" style="gap:6px">Rareté <select id="cRarity" style="width:auto;min-width:180px" disabled><option value="">Toutes</option></select></label>
        <label class="row small" style="gap:6px">Promos <select id="cPromo" style="width:auto"><option value="">Avec les promos</option><option value="only">Promos uniquement</option><option value="none">Sans les promos</option></select></label>
        <button type="button" class="btn sm" id="cPromos">Parcourir les promos</button></div>
      <span id="cStatus" class="muted small"></span>
    </div>
    <div class="cards" id="cGrid"></div>
    <div class="pager" id="cPager" hidden><button class="btn" id="cPrev">Précédent</button><span class="num" id="cPage"></span><button class="btn" id="cNext">Suivant</button></div>
  </section>`;
  root = el.firstElementChild;
  $('#cMode', root).value = st.mode; $('#cSort', root).value = st.sort;

  setPicker($('#cSet', root), () => groupsFor(st.lang), (s) => { st.set = s; if (s) { st.page = 1; search(); } });

  const qc = combo($('#cQ', root), {
    minChars: 2, debounce: 250, empty: 'Aucune carte ne commence comme ça.',
    source: async (q) => {
      if ($('#cMode', root).value !== 'name') return [];
      const list = await searchAny(st.lang, { q, mode: 'name', setId: st.set?.id || null }, S.settings.default_lang || 'fr');
      const langs = [...new Set(list.map((c) => c.lang))];
      const setsBy = new Map();
      await Promise.all(langs.map(async (l) => { for (const s of await getSets(l).catch(() => [])) setsBy.set(`${l}:${s.id}`, { s, i: setsBy.size }); }));
      const nq = norm(q), score = (c) => (norm(c.name) === nq ? 0 : norm(c.name).startsWith(nq) ? 1 : 2);
      qc.total = list.length;
      return list.map((c) => ({ ...c, set: setsBy.get(`${c.lang}:${setIdOf(c.id)}`)?.s, order: setsBy.get(`${c.lang}:${setIdOf(c.id)}`)?.i ?? 0 }))
        .sort((a, b) => score(a) - score(b) || b.order - a.order).slice(0, 8);
    },
    render: (c) => `${cardImg(c.image, c.name, 'thumb')}<div style="min-width:0;flex:1"><div class="ellip">${esc(c.name)}</div><div class="combo-sub ellip">${esc(c.set?.name || '')} · ${esc(c.localId)}${c.set?.cardCount?.official ? '/' + c.set.cardCount.official : ''}${st.lang === 'all' ? ' · ' + c.lang.toUpperCase() : ''}</div></div>${ownedQty(c.lang, c.id) ? `<span class="pill ok">×${ownedQty(c.lang, c.id)}</span>` : ''}`,
    footer: (q, items) => (items.length ? `<div class="combo-foot" data-keep data-all>Voir les ${qc.total > 8 ? qc.total + ' ' : ''}résultats pour « ${esc(q)} »</div>` : ''),
    onPick: (c) => openCard(c.lang, c.id),
  });
  qc.list.addEventListener('click', (e) => { if (e.target.closest('[data-all]')) { qc.close(); st.page = 1; search(); } });

  $('#cLang', root).onchange = () => { st.lang = $('#cLang', root).value; st.set = null; $('#cSet', root).value = ''; if (st.q) { st.page = 1; search(); } };
  $('#cForm', root).onsubmit = (e) => { e.preventDefault(); qc.close(); st.page = 1; search(); };
  $('#cSort', root).onchange = () => { st.sort = $('#cSort', root).value; st.page = 1; draw(); };
  $('#cRarity', root).onchange = () => { st.rarity = $('#cRarity', root).value; st.page = 1; draw(); };
  $('#cPromo', root).value = st.promo;
  $('#cPromo', root).onchange = () => { st.promo = $('#cPromo', root).value; st.page = 1; draw(); };
  // Raccourci : ouvre le choix de série directement sur le groupe « Promos »
  $('#cPromos', root).onclick = () => { const i = $('#cSet', root); i.value = 'Promos'; i.focus(); i.dispatchEvent(new Event('input')); };
  Promise.all([promoSets('fr'), promoSets('en'), promoSets('ja')]).then(() => { if (st.list.length) draw(); });
  $('#cPrev', root).onclick = () => { st.page--; draw(); scrollTo(0, 0); };
  $('#cNext', root).onclick = () => { st.page++; draw(); scrollTo(0, 0); };
  bindPlus($('#cGrid', root), (t) => quickAddCard(t.dataset.lang, t.dataset.id).then(() => tile(st.list.find((x) => x.id === t.dataset.id && x.lang === t.dataset.lang))));
  $('#cGrid', root).addEventListener('click', (e) => { const t = e.target.closest('.tile'); if (t) openCard(t.dataset.lang, t.dataset.id); });
  if (st.list.length) { draw(); rarities(); }
  else $('#cStatus', root).textContent = 'Tape le nom d’une carte, ou choisis une série pour la parcourir en entier.';
}

async function search() {
  st.q = $('#cQ', root).value.trim(); st.mode = $('#cMode', root).value; st.lang = $('#cLang', root).value;
  st.exact = $('#cExact', root).checked; st.sort = $('#cSort', root).value; st.rarity = '';
  if (!st.q && !st.set) { ++st.seq; st.list = []; $('#cGrid', root).innerHTML = ''; $('#cPager', root).hidden = true; rarities(); $('#cStatus', root).textContent = 'Saisis un nom, un numéro ou choisis une série.'; return; }
  const my = ++st.seq;
  $('#cStatus', root).innerHTML = `<span class="spin"></span> Recherche…`;
  $('#cGrid', root).innerHTML = '';
  try {
    const list = await searchAny(st.lang, { q: st.q, mode: st.mode, exact: st.exact, setId: st.set?.id || null }, S.settings.default_lang || 'fr');
    if (my !== st.seq) return;
    st.list = list;
    rarities(); draw(); loadDetails(my);
  } catch (e) {
    $('#cStatus', root).innerHTML = `<span class="loss">${esc(e.message)}. Vérifie ta connexion et réessaie.</span>`;
  }
}

/** Charge cotes et raretés de tous les résultats (en cache 24 h), pour trier et filtrer sur l'ensemble. */
async function loadDetails(my) {
  const todo = st.list.slice(0, MAX_DETAILS).filter((it) => !st.details.has(dkey(it)));
  if (!todo.length) { rarities(); return; }
  st.loading = true;
  let last = 0;
  await pool(todo, 8, async (it) => {
    const d = await getCard(it.lang, it.id).catch(() => null);
    st.details.set(dkey(it), d || { cm: null, rarity: null });
    if (my === st.seq) tile(it);
  }, (d, n) => {
    if (my !== st.seq || !root?.isConnected) return;
    $('#cStatus', root).textContent = `${count()} · cotes et raretés ${d}/${n}`;
    if (Date.now() - last > 1500) { last = Date.now(); rarities(); }
  });
  st.loading = false;
  if (my !== st.seq || !root?.isConnected) return;
  rarities();
  if (st.sort !== 'def' || st.rarity) draw(); else $('#cStatus', root).textContent = count();
}

const count = () => { const n = filtered().length; return `${n.toLocaleString('fr-FR')} carte${n > 1 ? 's' : ''}${st.set ? ' · ' + st.set.name : ''}${st.list.length > MAX_DETAILS ? ' · affine la recherche pour trier et filtrer par rareté' : ''}`; };
const priceOf = (it) => { const d = st.details.get(dkey(it)); return d ? cmPrice(d.cm, S.settings.basis, 'normal') : undefined; };

function rarities() {
  const sel = $('#cRarity', root); if (!sel) return;
  const cnt = new Map();
  for (const it of st.list) { const r = st.details.get(dkey(it))?.rarity; if (r && r !== 'None') cnt.set(r, (cnt.get(r) || 0) + 1); }
  const keep = st.rarity;
  sel.innerHTML = `<option value="">Toutes</option>` + [...cnt].sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([r, n]) => `<option value="${esc(r)}">${esc(r)} (${n})</option>`).join('');
  sel.value = cnt.has(keep) ? keep : '';
  sel.disabled = !cnt.size;
}

function filtered() {
  let L = st.rarity ? st.list.filter((it) => st.details.get(dkey(it))?.rarity === st.rarity) : st.list;
  if (st.promo) L = L.filter((it) => isPromoSet(setIdOf(it.id)) === (st.promo === 'only'));
  return L;
}
function sorted() {
  const L = filtered().slice();
  if (st.sort === 'price') L.sort((a, b) => (priceOf(b) ?? -1) - (priceOf(a) ?? -1));
  else if (st.sort === 'price_asc') L.sort((a, b) => (priceOf(a) ?? 1e9) - (priceOf(b) ?? 1e9));
  else if (st.sort === 'name') L.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return L;
}

function draw() {
  if (!root?.isConnected) return;
  const all = sorted(), pages = Math.max(1, Math.ceil(all.length / PER));
  st.page = Math.min(Math.max(1, st.page), pages);
  const items = all.slice((st.page - 1) * PER, st.page * PER);
  $('#cStatus', root).textContent = all.length ? count() + (st.loading && st.sort !== 'def' ? ' · tri en cours…' : '')
    : (st.list.length ? (st.promo ? (st.promo === 'only' ? 'Aucune promo dans ces résultats.' : 'Uniquement des promos dans ces résultats.') : 'Aucune carte de cette rareté.') : 'Aucune carte trouvée. Essaie une recherche partielle, ou « Toutes les langues ».');
  $('#cGrid', root).innerHTML = items.map((it) => `<button class="tile" data-id="${esc(it.id)}" data-lang="${it.lang}"><div class="img">${cardImg(it.image, it.name)}${st.lang === 'all' ? `<span class="langtag">${it.lang}</span>` : ''}<span class="own"></span>${plusBtn()}</div>
    <div class="t1 ellip">${esc(it.name)}</div><div class="t2"><span class="num">${esc(it.localId)}</span><b class="num pr">…</b></div></button>`).join('');
  $('#cPager', root).hidden = pages <= 1;
  $('#cPrev', root).disabled = st.page <= 1; $('#cNext', root).disabled = st.page >= pages;
  $('#cPage', root).textContent = `Page ${st.page} / ${pages}`;
  items.forEach(tile);
}

function tile(it) {
  if (!it) return;
  const el = root?.querySelector(`.tile[data-id="${CSS.escape(it.id)}"][data-lang="${it.lang}"]`);
  if (!el) return;
  const p = priceOf(it);
  el.querySelector('.pr').textContent = p === undefined ? '…' : p == null ? 'pas de cote' : eur(p);
  const own = ownedQty(it.lang, it.id);
  el.querySelector('.own').outerHTML = own ? `<span class="badge own">×${own}</span>` : `<span class="own"></span>`;
  const d = st.details.get(dkey(it));
  if (d?.set?.total) el.querySelector('.t2 span').textContent = `${it.localId}/${d.set.total}`;
}

export function update() { if (root?.isConnected) sorted().slice((st.page - 1) * PER, st.page * PER).forEach(tile); }
