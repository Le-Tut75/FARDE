import { S } from '../store.js';
import { getSetsNewestFirst, getSet, getCard } from '../tcgdex.js';
import { cmPrice } from '../valuation.js';
import { openCard } from '../carddialog.js';
import { esc, eur, cardImg, langOptions, frDate, pool, setPicker, $ } from '../ui.js';

const st = { lang: null, set: '', show: 'all', seq: 0 };
let root;

export function render(el) {
  st.lang = st.lang || S.settings.default_lang || 'fr';
  el.innerHTML = `<section class="view">
    <div class="vh"><div><h2>Complétion de série</h2><p>Vois ce qui te manque dans une extension, carte par carte.</p></div></div>
    <div class="row panel">
      <div class="field" style="flex:1 1 120px"><label for="xLang">Langue</label><select id="xLang">${langOptions(st.lang)}</select></div>
      <div class="field" style="flex:3 1 240px"><label for="xSet">Série</label><input id="xSet" type="text"></div>
      <div class="field" style="flex:1 1 140px"><label for="xShow">Afficher</label><select id="xShow"><option value="all">Toutes</option><option value="miss">Manquantes</option><option value="own">Possédées</option></select></div>
    </div>
    <div class="panel" id="xSum" hidden></div>
    <div class="setgrid" id="xGrid"></div>
  </section>`;
  root = el.firstElementChild;
  $('#xShow', root).value = st.show;
  $('#xLang', root).onchange = () => { st.lang = $('#xLang', root).value; st.set = ''; fill(); };
  setPicker($('#xSet', root), () => getSetsNewestFirst(st.lang), (s) => { if (s) { st.set = s.id; load(); } }, { allLabel: 'Tape le nom d’une série…' });
  $('#xShow', root).onchange = () => { st.show = $('#xShow', root).value; load(); };
  $('#xGrid', root).addEventListener('click', (e) => { const b = e.target.closest('.c[data-id]'); if (b) openCard(st.lang, b.dataset.id); });
  fill();
}

async function fill() {
  const inp = $('#xSet', root);
  try {
    const sets = await getSetsNewestFirst(st.lang);
    if (!st.set || !sets.some((s) => s.id === st.set)) {
      // Par défaut : la série où tu as le plus de cartes
      const cnt = {}; S.cards.filter((c) => c.lang === st.lang && c.set_id).forEach((c) => (cnt[c.set_id] = (cnt[c.set_id] || 0) + 1));
      st.set = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] || sets[0]?.id || '';
    }
    inp.value = sets.find((s) => s.id === st.set)?.name || '';
    load();
  } catch (e) { $('#xGrid', root).innerHTML = `<p class="loss">${esc(e.message)}</p>`; }
}

async function load() {
  if (!st.set || !root?.isConnected) return;
  const my = ++st.seq, lang = st.lang;
  $('#xGrid', root).innerHTML = '<span class="spin"></span>';
  let s;
  try { s = await getSet(lang, st.set); } catch (e) { $('#xGrid', root).innerHTML = `<p class="loss">${esc(e.message)}</p>`; return; }
  if (my !== st.seq || !s) return;
  const owned = new Set(S.cards.filter((l) => l.lang === lang).map((l) => l.card_id));
  const cards = s.cards, off = s.cardCount?.official || cards.length;
  const have = cards.filter((c) => owned.has(c.id)).length;
  const haveOff = cards.filter((c) => owned.has(c.id) && (parseInt(c.localId, 10) || 9999) <= off).length;
  const sum = $('#xSum', root); sum.hidden = false;
  sum.innerHTML = `<div class="row between"><div><h3 style="font-size:18px">${esc(s.name)}</h3><div class="muted">${s.releaseDate ? frDate(s.releaseDate, { dateStyle: 'long' }) + ' · ' : ''}${cards.length} cartes dont ${off} officielles</div></div>
    <div class="num" style="text-align:right;font-size:20px">${have}/${cards.length}<div class="muted small">set de base ${haveOff}/${off}</div></div></div>
    <div class="progress" style="margin-top:10px"><i style="width:${cards.length ? (have / cards.length) * 100 : 0}%"></i></div>
    <div class="row" style="margin-top:10px"><button class="btn sm" id="xCost">Estimer le coût des manquantes</button><span class="note" id="xCostOut"></span></div>`;
  $('#xGrid', root).innerHTML = cards.filter((c) => st.show === 'all' || (st.show === 'own') === owned.has(c.id))
    .map((c) => `<button class="c ${owned.has(c.id) ? '' : 'miss'}" data-id="${esc(c.id)}" title="${esc(c.name)}">${cardImg(c.image, c.name)}<span>${esc(c.localId)}</span></button>`).join('') || `<div class="empty">Rien à afficher.</div>`;
  $('#xCost', root).onclick = async (e) => {
    e.target.disabled = true;
    const miss = cards.filter((c) => !owned.has(c.id)), out = $('#xCostOut', root);
    const res = await pool(miss, 6, (c) => getCard(lang, c.id), (d, n) => (out.textContent = `Chargement des cotes ${d}/${n}…`));
    let total = 0, unk = 0;
    res.forEach((c) => { const p = cmPrice(c?.cm, S.settings.basis, 'normal'); if (p == null) unk++; else total += p; });
    out.innerHTML = `${miss.length} manquantes · environ <b class="num">${eur(total)}</b>${unk ? ` · ${unk} sans cote` : ''}`;
  };
}

let lastSig = '';
export function update() {
  const sig = `${S.cards.length}:${S.cards.reduce((a, c) => a + c.qty, 0)}`;
  if (root?.isConnected && sig !== lastSig) { lastSig = sig; load(); }
}
