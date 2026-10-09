// Ajout manuel d'une carte : une recherche, des vignettes avec « + ». Rien d'autre.
import { S, ownedQty } from '../store.js';
import { searchAny, getCard, getSets, getSet, LANG_ORDER, promoSets } from '../tcgdex.js';
import { normLocal } from '../match.js';
import { parseScan, resolveScan } from '../scan.js';
import { cmPrice } from '../valuation.js';
import { openCard } from '../carddialog.js';
import { plusBtn, quickAddCard, bindPlus } from '../quick.js';
import { esc, eur, cardImg, LANGS, pool, $ } from '../ui.js';

const st = { q: '', lang: 'all', list: [], seq: 0, set: null };
let root;

export function render(el) {
  const qp = new URLSearchParams(location.hash.split('?')[1] || '');
  if (qp.has('q')) st.q = qp.get('q');
  el.innerHTML = `<section class="view">
    <div class="vh"><div><h2>Ajouter une carte</h2><p>Cherche ta carte par son nom ou son numéro, puis clique sur « + » : elle est ajoutée à ta collection (Near Mint, sans prix). Clique sur la carte elle-même pour choisir la version, l’état et le prix d’achat.</p></div></div>
    <form class="panel row" id="aForm" style="padding:14px">
      <div class="field" style="flex:3 1 260px"><label for="aQ">Nom ou numéro</label><input id="aQ" type="search" value="${esc(st.q)}" placeholder="Dracaufeu, Charizard, 58/102, MEW 199…" autocomplete="off" enterkeyhint="search"></div>
      <div class="field" style="flex:1 1 150px"><label for="aLang">Langue</label><select id="aLang"><option value="all">Toutes</option>${LANG_ORDER.map((k) => `<option value="${k}">${LANGS[k]}</option>`).join('')}</select></div>
    </form>
    <div class="promo-bar"><span class="lbl">Promos</span><div class="row" id="aPromos" style="gap:6px"><span class="spin"></span></div></div>
    <div class="muted small" id="aInfo"></div>
    <div class="cards" id="aGrid"></div>
  </section>`;
  root = el.firstElementChild;
  $('#aLang', root).value = st.lang;
  let t;
  $('#aQ', root).addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 350); });
  $('#aForm', root).onsubmit = (e) => { e.preventDefault(); clearTimeout(t); run(); };
  $('#aLang', root).onchange = () => { st.lang = $('#aLang', root).value; st.set = null; promos(); run(); };
  $('#aPromos', root).onclick = (e) => {
    const b = e.target.closest('[data-set]'); if (!b) return;
    st.set = st.set?.id === b.dataset.set ? null : { id: b.dataset.set, name: b.dataset.name, lang: b.dataset.lang };
    promos(); run();
  };
  promos();
  bindPlus($('#aGrid', root), async (tile) => { await quickAddCard(tile.dataset.lang, tile.dataset.id); badge(tile); });
  $('#aGrid', root).addEventListener('click', (e) => { const x = e.target.closest('.tile'); if (x) openCard(x.dataset.lang, x.dataset.id); });
  $('#aQ', root).focus();
  if (st.q) run(); else $('#aInfo', root).textContent = 'Tape au moins 2 lettres, ou un numéro comme 199/165.';
}

async function run() {
  st.q = $('#aQ', root).value.trim(); st.lang = $('#aLang', root).value;
  const my = ++st.seq, grid = $('#aGrid', root), info = $('#aInfo', root);
  if (st.set) return browseSet(my);
  if (st.q.length < 2) { grid.innerHTML = ''; info.textContent = 'Tape au moins 2 lettres, ou un numéro comme 199/165. Pour une promo : « SVP 85 », « SWSH050 », ou choisis une série de promos ci-dessus.'; return; }
  info.innerHTML = '<span class="spin"></span> Recherche…';
  try {
    let list = [];
    // « 199/165 », « MEW 199 » : on cherche la carte exacte, comme le scan
    const p = parseScan(st.q);
    if (p.local && (p.total || p.setId)) {
      const lang = st.lang === 'all' ? (p.lang || S.settings.default_lang || 'fr') : st.lang;
      const r = await resolveScan(p, { getSets, getSet }, { lang });
      list = (r.candidates || []).map((c) => ({ id: c.id, localId: c.localId, name: c.name, image: c.image, lang }));
    }
    if (!list.length) list = await searchAny(st.lang, { q: st.q, mode: /^\d{1,3}$/.test(st.q) ? 'num' : 'name' }, S.settings.default_lang || 'fr');
    if (my !== st.seq || !root?.isConnected) return;
    st.list = list.slice(0, 60);
    info.textContent = list.length ? `${list.length} carte${list.length > 1 ? 's' : ''}${list.length > 60 ? ' · 60 premières affichées, précise ta recherche (ex. « Dracaufeu 151 » ou le numéro)' : ''}` : 'Aucune carte trouvée. Essaie le nom anglais, ou « Toutes » les langues.';
    tiles(my);
  } catch (e) { if (my === st.seq) info.innerHTML = `<span class="loss">${esc(e.message)}</span>`; }
}

/** Une série de promos en entier (numéros les plus récents d'abord), filtrée par le champ de recherche. */
async function browseSet(my) {
  const grid = $('#aGrid', root), info = $('#aInfo', root);
  info.innerHTML = '<span class="spin"></span> Chargement de la série…';
  try {
    const s = await getSet(st.set.lang, st.set.id);
    if (my !== st.seq || !root?.isConnected) return;
    const q = st.q.toLowerCase(), n = normLocal(String(st.q).replace(/^[a-z]+\s*/i, ''));
    let cards = (s?.cards || []).filter((c) => !q || c.name.toLowerCase().includes(q) || normLocal(String(c.localId).replace(/^[A-Z]+/i, '')) === n);
    cards = cards.reverse();
    st.list = cards.slice(0, 120).map((c) => ({ ...c, lang: st.set.lang }));
    info.textContent = `${s?.name || st.set.name} · ${cards.length} carte${cards.length > 1 ? 's' : ''}${cards.length > 120 ? ' · 120 plus récentes affichées : tape un nom ou un numéro pour filtrer' : ''}`;
    tiles(my);
  } catch (e) { if (my === st.seq) info.innerHTML = `<span class="loss">${esc(e.message)}</span>`; }
}

/** Raccourcis vers les séries de promos (Black Star Promos…). */
async function promos() {
  const el = $('#aPromos', root); if (!el) return;
  const lang = st.lang === 'all' ? (S.settings.default_lang || 'fr') : st.lang;
  let sets = await promoSets(lang), l = lang;
  if (!sets.length && lang !== 'en') { sets = await promoSets('en'); l = 'en'; }
  if (!el.isConnected) return;
  el.innerHTML = sets.slice(0, 12).map((s) => `<button type="button" class="chip" data-set="${esc(s.id)}" data-name="${esc(s.name)}" data-lang="${esc(l)}" aria-pressed="${st.set?.id === s.id}">${esc(s.name)}</button>`).join('') || '<span class="muted small">Aucune série de promos dans cette langue.</span>';
}

async function tiles(my) {
  const grid = $('#aGrid', root), info = $('#aInfo', root);
  try {
    grid.innerHTML = st.list.map((c) => `<button class="tile" data-id="${esc(c.id)}" data-lang="${c.lang}"><div class="img">${cardImg(c.image, c.name)}${st.lang === 'all' ? `<span class="langtag">${c.lang}</span>` : ''}<span class="own"></span>${plusBtn()}</div>
      <div class="t1 ellip">${esc(c.name)}</div><div class="t2"><span class="num ellip">${esc(c.localId)}</span><b class="num pr">…</b></div></button>`).join('');
    grid.querySelectorAll('.tile').forEach(badge);
    // Série, total et cote de chaque carte (en cache 24 h)
    await pool(st.list, 6, async (c) => {
      const d = await getCard(c.lang, c.id).catch(() => null);
      if (my !== st.seq) return;
      const el = grid.querySelector(`.tile[data-id="${CSS.escape(c.id)}"][data-lang="${c.lang}"]`); if (!el) return;
      const pr = d ? cmPrice(d.cm, S.settings.basis, 'normal') : null;
      el.querySelector('.pr').textContent = pr == null ? '—' : eur(pr);
      if (d?.set) el.querySelector('.t2 span').textContent = `${d.set.name} · ${c.localId}${d.set.total ? '/' + d.set.total : ''}`;
    });
  } catch (e) { if (my === st.seq) info.innerHTML = `<span class="loss">${esc(e.message)}</span>`; }
}

function badge(tile) {
  const n = ownedQty(tile.dataset.lang, tile.dataset.id);
  tile.querySelector('.own').outerHTML = n ? `<span class="own badge own-l">×${n}</span>` : '<span class="own"></span>';
}
export function update() { if (root?.isConnected) root.querySelectorAll('#aGrid .tile').forEach(badge); }
