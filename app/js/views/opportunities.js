// Opportunités : cartes dont la cote Cardmarket est nettement sous sa moyenne des 30 derniers jours.
import { S, sb, ownedQty } from '../store.js';
import { openCard } from '../carddialog.js';
import { esc, eur, cardImg, frDateTime, num, $ } from '../ui.js';
import { plusBtn, quickAddCard, bindPlus } from '../quick.js';

const st = { rows: null, q: '', min: '', max: '', drop: '15', sort: 'drop', img: false, mine: false, win: '30' };
const WIN = { 30: '30 jours', 90: '3 mois', 180: '6 mois', 365: '1 an' };
const dropOf = (r) => Number(st.win === '30' ? r.drop_pct : r[`drop_${st.win}`]);
const refOf = (r) => Number(st.win === '30' ? r.avg30 : r[`ref_${st.win}`]);
const inWin = (r) => (r.win ? r.win.includes(st.win) : st.win === '30');
let root;

export function render(el) {
  el.innerHTML = `<section class="view">
    <div class="vh"><div><h2>Opportunités</h2><p>Cartes dont la cote Cardmarket du jour est nettement sous son niveau d’il y a 30 jours, 3 mois, 6 mois ou 1 an, avec une baisse confirmée par la dernière semaine. Une baisse n’est pas forcément une bonne affaire : vérifie les annonces avant d’acheter.</p></div>
      <span class="muted small" id="oUpd"></span></div>
    <div class="panel">
      <div class="seg" id="oWin" role="tablist" style="margin-bottom:12px">${Object.entries(WIN).map(([k, l]) => `<button type="button" data-w="${k}" aria-selected="${k === st.win}">Baisse sur ${l}</button>`).join('')}</div>
      <div class="ofilters">
        <div class="field"><label for="oQ">Carte ou série</label><input id="oQ" type="search" placeholder="Dracaufeu, Évolution Céleste…" value="${esc(st.q)}"></div>
        <div class="field"><label for="oMin">Prix min (€)</label><input id="oMin" type="number" min="0" inputmode="decimal" value="${esc(st.min)}" placeholder="10"></div>
        <div class="field"><label for="oMax">Prix max (€)</label><input id="oMax" type="number" min="0" inputmode="decimal" value="${esc(st.max)}" placeholder="sans limite"></div>
        <div class="field"><label for="oDrop">Baisse d’au moins</label><select id="oDrop"><option value="15">15 %</option><option value="25">25 %</option><option value="35">35 %</option><option value="45">45 %</option></select></div>
        <div class="field"><label for="oSort">Tri</label><select id="oSort"><option value="drop">Plus forte baisse</option><option value="euros">Plus gros écart en €</option><option value="price_desc">Prix décroissant</option><option value="price_asc">Prix croissant</option></select></div>
      </div>
      <div class="row" style="margin-top:10px">
        <label class="row small" style="gap:6px"><input type="checkbox" id="oImg" ${st.img ? 'checked' : ''}> Seulement les cartes identifiées (avec image)</label>
        <label class="row small" style="gap:6px"><input type="checkbox" id="oMine" ${st.mine ? 'checked' : ''}> Seulement ma wishlist et ma collection</label>
      </div>
    </div>
    <div class="muted small" id="oInfo"></div>
    <div class="cards" id="oGrid"></div>
  </section>`;
  root = el.firstElementChild;
  $('#oDrop', root).value = st.drop; $('#oSort', root).value = st.sort;
  const bind = (id, key, ev = 'input') => $(id, root).addEventListener(ev, (e) => { st[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; draw(); });
  bind('#oQ', 'q'); bind('#oMin', 'min'); bind('#oMax', 'max'); bind('#oDrop', 'drop', 'change'); bind('#oSort', 'sort', 'change'); bind('#oImg', 'img', 'change'); bind('#oMine', 'mine', 'change');
  bindPlus($('#oGrid', root), (t) => quickAddCard(t.dataset.lang, t.dataset.card).then(draw));
  $('#oWin', root).onclick = (e) => {
    const b = e.target.closest('[data-w]'); if (!b) return;
    st.win = b.dataset.w; root.querySelectorAll('#oWin [data-w]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.w === st.win)));
    // Seuil par défaut plus large sur les longues périodes
    if (st.win !== '30' && st.drop === '15') { st.drop = '25'; $('#oDrop', root).value = '25'; }
    draw();
  };
  $('#oGrid', root).addEventListener('click', (e) => {
    const t = e.target.closest('[data-card]');
    if (t) openCard(t.dataset.lang, t.dataset.card);
  });
  load();
}

async function load() {
  if (st.rows) { draw(); return; }
  $('#oGrid', root).innerHTML = '<span class="spin"></span>';
  const { data, error } = await sb.from('deals').select('*').order('drop_pct').limit(1500);
  if (!root?.isConnected) return;
  if (error) { $('#oGrid', root).innerHTML = `<p class="loss">${esc(error.message)}</p>`; return; }
  st.rows = data || [];
  draw();
}

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function draw() {
  if (!root?.isConnected || !st.rows) return;
  if (!st.rows.length) {
    $('#oGrid', root).innerHTML = `<div class="empty" style="grid-column:1/-1">Aucune opportunité pour l’instant. La liste est calculée chaque matin par la mise à jour automatique : lance « Prix quotidiens » dans GitHub › Actions pour la remplir tout de suite.</div>`;
    $('#oInfo', root).textContent = ''; return;
  }
  $('#oUpd', root).textContent = `Mise à jour : ${frDateTime(st.rows[0].updated_at)}`;
  const q = fold(st.q), min = num(st.min), max = num(st.max), drop = -Number(st.drop);
  const mine = new Set([...S.wish, ...S.cards].map((c) => c.card_id));
  // Période longue pas encore disponible : l'historique du marché se constitue semaine après semaine
  if (st.win !== '30' && !st.rows.some((r) => r[`ref_${st.win}`] != null)) {
    const since = S.lastJob?.summary?.marketSince;
    const when = since ? new Date(new Date(since).getTime() + Number(st.win) * 864e5).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
    $('#oInfo', root).textContent = '';
    $('#oGrid', root).innerHTML = `<div class="empty" style="grid-column:1/-1">Cardmarket ne publie que la moyenne des 30 derniers jours. Pour comparer sur ${WIN[st.win]}, Farde relève chaque semaine la cote des cartes à 5 € et plus.<br>${when ? `Historique commencé le ${new Date(since).toLocaleDateString('fr-FR')} : comparaison sur ${WIN[st.win]} disponible à partir du <b>${when}</b>.` : 'Le premier relevé sera fait à la prochaine mise à jour du matin.'}</div>`;
    return;
  }
  let L = st.rows.filter((r) => inWin(r) && dropOf(r) <= drop
    && (min == null || Number(r.trend) >= min) && (max == null || Number(r.trend) <= max)
    && (!st.img || r.card_id) && (!st.mine || (r.card_id && mine.has(r.card_id)))
    && (!q || fold(`${r.name} ${r.name_fr} ${r.set_name}`).includes(q)));
  const gap = (r) => refOf(r) - Number(r.trend);
  if (st.sort === 'drop') L.sort((a, b) => dropOf(a) - dropOf(b));
  else if (st.sort === 'euros') L.sort((a, b) => gap(b) - gap(a));
  else if (st.sort === 'price_desc') L.sort((a, b) => b.trend - a.trend);
  else L.sort((a, b) => a.trend - b.trend);
  $('#oInfo', root).textContent = `${L.length} carte${L.length > 1 ? 's' : ''} en baisse sur ${WIN[st.win]} (repérées ce matin)`;
  $('#oGrid', root).innerHTML = L.slice(0, 120).map((r) => {
    const name = r.name_fr || r.name;
    const own = r.card_id ? ownedQty(r.lang, r.card_id) : 0;
    const inner = `<div class="img">${cardImg(r.image, name)}<span class="badge down">${String(dropOf(r)).replace('.', ',')} %</span>${own ? `<span class="badge own-l">×${own}</span>` : ''}${r.card_id ? plusBtn() : ''}</div>
      <div class="t1 ellip">${esc(name)}</div>
      <div class="t2"><span class="ellip">${esc(r.set_name || 'Série non identifiée')}${r.local_id ? ' · ' + esc(r.local_id) : ''}</span></div>
      <div class="t2"><b class="num">${eur(r.trend)}</b><span class="num">${st.win === '30' ? 'moy. 30 j' : `il y a ${WIN[st.win]}`} <s>${eur(refOf(r))}</s></span></div>`;
    return r.card_id
      ? `<button class="tile" data-card="${esc(r.card_id)}" data-lang="${esc(r.lang)}">${inner}</button>`
      : `<a class="tile" href="https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(r.name)}" target="_blank" rel="noopener" style="text-decoration:none">${inner}</a>`;
  }).join('') || `<div class="empty" style="grid-column:1/-1">Aucune carte ne correspond à ces filtres.</div>`;
}

export function update() { /* la liste ne change qu'une fois par jour */ }
