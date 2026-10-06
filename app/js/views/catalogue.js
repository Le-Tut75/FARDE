import { S, ownedQty } from '../store.js';
import { getSetsNewestFirst, searchCards, getCard } from '../tcgdex.js';
import { cmPrice } from '../valuation.js';
import { openCard } from '../carddialog.js';
import { esc, eur, cardImg, langOptions, pool, $, $$ } from '../ui.js';

const PER = 24;
const st = { q: '', mode: 'name', lang: null, set: '', sort: 'def', exact: false, page: 1, list: [], details: new Map(), seq: 0 };
let root;

export function render(el) {
  st.lang = st.lang || S.settings.default_lang || 'fr';
  el.innerHTML = `<section class="view">
    <div class="vh"><div><h2>Catalogue</h2><p>Toutes les cartes Pokémon via TCGdex, en 6 langues. Clique sur une carte pour voir sa cote et l’ajouter.</p></div></div>
    <form class="panel search" id="cForm">
      <div class="field q"><label for="cQ">Recherche</label><input id="cQ" type="search" placeholder="Dracaufeu, 199, Mitsuhiro Arita…" autocomplete="off" value="${esc(st.q)}"></div>
      <div class="field"><label for="cMode">Par</label><select id="cMode"><option value="name">Nom</option><option value="num">Numéro</option><option value="illu">Illustrateur</option></select></div>
      <div class="field"><label for="cLang">Langue</label><select id="cLang">${langOptions(st.lang)}</select></div>
      <div class="field"><label for="cSet">Série</label><select id="cSet"><option value="">Toutes</option></select></div>
      <div class="field"><label for="cSort">Tri</label><select id="cSort"><option value="def">Numéro</option><option value="price">Prix décroissant</option><option value="name">Nom</option></select></div>
      <div class="field"><label>&nbsp;</label><button class="btn pri" type="submit">Chercher</button></div>
    </form>
    <label class="row note" style="gap:6px"><input type="checkbox" id="cExact" ${st.exact ? 'checked' : ''}> Nom exact uniquement</label>
    <div id="cStatus" class="muted"></div>
    <div class="cards" id="cGrid"></div>
    <div class="pager" id="cPager" hidden><button class="btn" id="cPrev">Précédent</button><span class="num" id="cPage"></span><button class="btn" id="cNext">Suivant</button></div>
  </section>`;
  root = el.firstElementChild;
  $('#cMode', root).value = st.mode; $('#cSort', root).value = st.sort;
  fillSets();
  $('#cLang', root).onchange = () => { st.lang = $('#cLang', root).value; st.set = ''; fillSets(); };
  $('#cForm', root).onsubmit = (e) => { e.preventDefault(); st.page = 1; search(); };
  $('#cSort', root).onchange = () => { st.sort = $('#cSort', root).value; draw(); };
  $('#cPrev', root).onclick = () => { st.page--; draw(); scrollTo(0, 0); };
  $('#cNext', root).onclick = () => { st.page++; draw(); scrollTo(0, 0); };
  $('#cGrid', root).addEventListener('click', (e) => { const t = e.target.closest('.tile'); if (t) openCard(st.lang, t.dataset.id); });
  if (st.list.length) draw();
  else $('#cStatus', root).textContent = 'Cherche une carte par son nom, son numéro ou son illustrateur, ou choisis une série.';
}

async function fillSets() {
  const sel = $('#cSet', root);
  sel.innerHTML = `<option value="">Chargement…</option>`;
  try {
    const sets = await getSetsNewestFirst(st.lang);
    sel.innerHTML = `<option value="">Toutes</option>` + sets.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    sel.value = st.set;
  } catch { sel.innerHTML = `<option value="">Séries indisponibles</option>`; }
}

async function search() {
  st.q = $('#cQ', root).value.trim(); st.mode = $('#cMode', root).value; st.lang = $('#cLang', root).value;
  st.set = $('#cSet', root).value; st.exact = $('#cExact', root).checked; st.sort = $('#cSort', root).value;
  if (!st.q && !st.set) { $('#cStatus', root).textContent = 'Saisis un nom, un numéro ou choisis une série.'; return; }
  const my = ++st.seq;
  $('#cStatus', root).innerHTML = `<span class="spin"></span> Recherche…`;
  $('#cGrid', root).innerHTML = '';
  try {
    const list = await searchCards(st.lang, { q: st.q, mode: st.mode, exact: st.exact, setId: st.set || null });
    if (my !== st.seq) return;
    st.list = list;
    draw();
  } catch (e) {
    $('#cStatus', root).innerHTML = `<span class="loss">${esc(e.message)}. Vérifie ta connexion et réessaie.</span>`;
  }
}

const priceOf = (id) => { const d = st.details.get(`${st.lang}:${id}`); return d ? cmPrice(d.cm, S.settings.basis, 'normal') : undefined; };

function sorted() {
  const L = st.list.slice();
  if (st.sort === 'price') L.sort((a, b) => (priceOf(b.id) ?? -1) - (priceOf(a.id) ?? -1));
  else if (st.sort === 'name') L.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return L;
}

async function draw() {
  if (!root?.isConnected) return;
  const all = sorted(), pages = Math.max(1, Math.ceil(all.length / PER));
  st.page = Math.min(Math.max(1, st.page), pages);
  const items = all.slice((st.page - 1) * PER, st.page * PER);
  $('#cStatus', root).textContent = all.length ? `${all.length.toLocaleString('fr-FR')} carte${all.length > 1 ? 's' : ''}` : 'Aucune carte trouvée. Essaie une recherche partielle, une autre langue ou sans série.';
  $('#cGrid', root).innerHTML = items.map((it) => `<button class="tile" data-id="${esc(it.id)}"><div class="img">${cardImg(it.image, it.name)}<span class="own"></span></div>
    <div class="t1 ellip">${esc(it.name)}</div><div class="t2"><span class="num">${esc(it.localId)}</span><b class="num pr">…</b></div></button>`).join('');
  $('#cPager', root).hidden = pages <= 1;
  $('#cPrev', root).disabled = st.page <= 1; $('#cNext', root).disabled = st.page >= pages;
  $('#cPage', root).textContent = `Page ${st.page} / ${pages}`;
  items.forEach(tile);
  // Cotes des cartes affichées
  const lang = st.lang;
  await pool(items.filter((it) => !st.details.has(`${lang}:${it.id}`)), 6, async (it) => {
    const d = await getCard(lang, it.id).catch(() => null);
    st.details.set(`${lang}:${it.id}`, d || { cm: null });
    tile(it);
  });
}

function tile(it) {
  const el = root?.querySelector(`.tile[data-id="${CSS.escape(it.id)}"]`);
  if (!el) return;
  const p = priceOf(it.id);
  el.querySelector('.pr').textContent = p === undefined ? '…' : p == null ? 'pas de cote' : eur(p);
  const own = ownedQty(st.lang, it.id);
  el.querySelector('.own').outerHTML = own ? `<span class="badge own">×${own}</span>` : `<span class="own"></span>`;
  const d = st.details.get(`${st.lang}:${it.id}`);
  if (d?.set?.total) el.querySelector('.t2 span').textContent = `${it.localId}/${d.set.total}`;
}

export function update() { if (root?.isConnected) st.list.slice((st.page - 1) * PER, st.page * PER).forEach(tile); }
