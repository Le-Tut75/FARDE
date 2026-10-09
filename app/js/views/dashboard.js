// Tableau de bord : pilotage du portefeuille (KPI, hausses et baisses du mois, évolution, répartition).
import { S, totals, calcLine, calcSealed, priceOf } from '../store.js';
import { openCard } from '../carddialog.js';
import { sealedImg, sealedImage, openSealed } from './sealed.js';
import { lineCalc, saleCalc, round2 } from '../valuation.js';
import { esc, eur, signEur, pct, plClass, cardImg, lineChart, frDateTime, $, $$ } from '../ui.js';

const FILTERS = [['all', 'Tout'], ['loose', 'Cartes loose'], ['graded', 'Cartes gradées'], ['sealed', 'Scellés']];
let root, filter = 'all';

export function render(el) {
  el.innerHTML = `<section class="view">
    <div class="vh"><div><h2>Tableau de bord</h2><p id="dSub"></p></div>
      <div class="row"><div class="status" id="dJob"></div><a class="btn pri" href="#ajouter"><svg class="ic"><use href="#i-plus"/></svg>Importer mes cartes &amp; items scellés</a></div></div>
    <div class="seg" id="dFilt" role="tablist">${FILTERS.map(([k, l]) => `<button type="button" data-f="${k}" role="tab">${l} <span class="num" data-n="${k}"></span></button>`).join('')}</div>
    <div class="dash" id="dMain">
      <div class="worth">
        <div><div class="lbl" id="dLbl">Valeur totale</div><div class="big" id="dValue">0 €</div></div>
        <div class="split">
          <div><span class="lbl">Investi</span><b id="dInv"></b><span class="lbl small" id="dSpent"></span></div>
          <div><span class="lbl">Plus-value latente</span><b id="dLat"></b></div>
          <div><span class="lbl">Rendement</span><b id="dPct"></b></div>
        </div>
        <div class="split">
          <div><span class="lbl">Plus-value réalisée</span><b id="dReal"></b></div>
          <div><span class="lbl">Plus-value totale</span><b id="dPL"></b></div>
          <div><span class="lbl" id="dCntL">Items</span><b id="dCards"></b></div>
        </div>
        <div class="kpis" id="dKpis"></div>
      </div>
      <div class="movers">
        <div class="panel"><h3>Top hausses <span class="muted small">30 jours</span></h3><div class="toplist mv" id="dUp"></div></div>
        <div class="panel"><h3>Chutes de valeur <span class="muted small">30 jours</span></h3><div class="toplist mv" id="dDown"></div></div>
      </div>
    </div>
    <div class="empty-dash panel" id="dEmpty" hidden>
      <h3>Ton tableau de bord est vide</h3><p class="muted">Ajoute tes cartes et tes produits scellés : la valeur, la plus-value et les hausses du mois s’afficheront ici.</p>
      <a class="btn pri" href="#ajouter"><svg class="ic"><use href="#i-plus"/></svg>Importer mes cartes &amp; items scellés</a>
    </div>
    <div class="panel chart" id="dChartP"><div class="row between"><h3 id="dChartT">Évolution de la valeur</h3><span class="muted small" id="dRange"></span></div><div id="dChart"></div></div>
    <div class="grid2" id="dGrid">
      <div class="panel"><h3 style="margin-bottom:8px">Plus grosses valeurs</h3><div class="toplist" id="dTop"></div></div>
      <div class="panel"><h3 style="margin-bottom:8px" id="dRepT">Répartition</h3><div class="bars" id="dSets"></div></div>
    </div>
    <p class="note" id="dNote"></p>
  </section>`;
  root = el.firstElementChild;
  root.addEventListener('click', (e) => {
    const f = e.target.closest('[data-f]');
    if (f) { filter = f.dataset.f; update(); return; }
    const it = e.target.closest('[data-item]');
    if (!it) return;
    const [kind, id] = it.dataset.item.split('|');
    if (kind === 'card') { const l = S.cards.find((c) => c.id === id); if (l) openCard(l.lang, l.card_id, { line: l }); }
    else { const s = S.sealed.find((x) => x.id === id); if (s) openSealed(s); }
  });
  update();
}

// ---- Données par item (carte ou scellé), avec la variation sur 30 jours ----
const kindOf = (l) => (l.grading_company ? 'graded' : 'loose');
function moverOf(l) {
  const own = S.movers.find((m) => m.lang === l.lang && m.card_id === l.card_id && m.item.includes('~') && m.variant === l.variant);
  if (own) return own;
  const rev = String(l.variant).startsWith('reverse');
  return S.movers.find((m) => m.lang === l.lang && m.card_id === l.card_id && !m.item.includes('~') && m.item.endsWith('#reverse') === rev);
}

/** Variation 30 jours : historique Farde si on l'a, sinon cote du jour comparée à la moyenne 30 jours Cardmarket. */
function cardItem(l) {
  const c = calcLine(l);
  let ratio = null, src = null;
  if (c.value != null && c.source !== 'manuel') {
    const m = moverOf(l);
    if (Number(m?.price30) > 0 && Number(m?.price) > 0) { ratio = Number(m.price) / Number(m.price30); src = 'hist'; }
    else {
      const p = priceOf(l.lang, l.card_id), raw = { ...l, manual_price: null, grading_company: null };
      const now = lineCalc(raw, p, { ...S.settings, basis: 'trend' }).unit;
      const past = lineCalc(raw, p, { ...S.settings, basis: 'avg30' }).unit;
      if (now > 0 && past > 0 && now !== past) { ratio = now / past; src = 'avg'; }
    }
  }
  const chg = ratio ? round2(c.value - c.value / ratio) : null;
  return { kind: kindOf(l), id: l.id, name: l.name, sub: `${l.set_name || ''}${l.local_id ? ' · ' + l.local_id : ''}${l.grading_company ? ` · ${l.grading_company} ${l.grade || ''}` : ''}${l.qty > 1 ? ' · ×' + l.qty : ''}`,
    img: cardImg(l.image, l.name, 'thumb'), value: c.value, invested: c.invested, pl: c.pl, chg, chgPct: ratio ? (ratio - 1) * 100 : null, src, line: l, set: l.set_name || 'Sans série' };
}
function sealedItem(s) {
  const c = calcSealed(s), p = s.cm_id != null ? S.sealedPrices.get(Number(s.cm_id)) : null;
  let ratio = null;
  if (c.source === 'cote' && Number(p?.trend) > 0 && Number(p?.avg30) > 0 && Number(p.trend) !== Number(p.avg30)) ratio = Number(p.trend) / Number(p.avg30);
  const chg = ratio && c.value != null ? round2(c.value - c.value / ratio) : null;
  return { kind: 'sealed', id: s.id, name: s.name, sub: `${s.category || 'Scellé'}${s.qty > 1 ? ' · ×' + s.qty : ''}`, img: sealedImg(sealedImage(s), s.name, 'sthumb'),
    value: c.value, invested: c.invested, pl: c.pl, chg, chgPct: ratio ? (ratio - 1) * 100 : null, src: ratio ? 'avg' : null, line: s, set: s.category || 'Scellés' };
}

export function update() {
  if (!root?.isConnected) return;
  const t = totals();
  const all = [...S.cards.map(cardItem), ...S.sealed.map(sealedItem)];
  const items = filter === 'all' ? all : all.filter((x) => x.kind === filter);
  const cnt = { loose: 0, graded: 0, sealed: 0 };
  for (const x of all) cnt[x.kind] += x.line.qty || 1;
  cnt.all = cnt.loose + cnt.graded + cnt.sealed;
  $$('#dFilt [data-f]', root).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.f === filter)));
  $$('#dFilt [data-n]', root).forEach((s) => { s.textContent = cnt[s.dataset.n] || ''; });

  // KPI du filtre
  const value = items.reduce((a, x) => a + (x.value || 0), 0);
  let invested = items.reduce((a, x) => a + x.invested, 0);
  const sales = S.sales.filter((s) => filter === 'all' || (filter === 'sealed' ? s.kind === 'sealed' : s.kind === 'card' && (filter === 'graded') === !!s.item?.grading_company));
  const realized = sales.reduce((a, s) => a + saleCalc(s).pl, 0), soldCost = sales.reduce((a, s) => a + saleCalc(s).cost, 0);
  if (filter === 'all') invested = t.invested;   // les dépenses (ouvertures, lots) ne comptent que dans le total
  const latent = value - invested, plTot = latent + realized, base = invested + soldCost;
  $('#dLbl', root).textContent = filter === 'all' ? 'Valeur totale' : `Valeur · ${FILTERS.find((f) => f[0] === filter)[1]}`;
  $('#dValue', root).textContent = eur(value);
  $('#dInv', root).textContent = eur(invested);
  $('#dSpent', root).innerHTML = filter === 'all' && t.spent ? `dont <a href="#depenses" style="color:inherit">${eur(t.spent)} de dépenses</a>` : '';
  const set = (id, v, txt) => { const e = $(id, root); e.innerHTML = txt; e.className = v > 0.004 ? 'pos' : v < -0.004 ? 'neg' : ''; };
  set('#dLat', latent, signEur(round2(latent)));
  set('#dReal', realized, sales.length ? `<a href="#ventes" style="color:inherit">${signEur(round2(realized))}</a>` : '<a href="#ventes" style="color:inherit;font-weight:500" class="small">aucune vente</a>');
  set('#dPL', plTot, signEur(round2(plTot)));
  set('#dPct', plTot, base ? pct((plTot / base) * 100) : '—');
  $('#dCntL', root).textContent = filter === 'sealed' ? 'Produits' : filter === 'all' ? 'Items' : 'Cartes';
  $('#dCards', root).textContent = cnt[filter].toLocaleString('fr-FR');
  const toCheck = items.filter((x) => x.kind !== 'sealed' && calcLine(x.line).toCheck).length;
  const kp = [];
  if (toCheck) kp.push(`<a href="#collection?type=check"><b>${toCheck}</b> à coter à la main</a>`);
  if (filter === 'all' && t.alerts) kp.push(`<a href="#wishlist"><b>${t.alerts}</b> alerte${t.alerts > 1 ? 's' : ''} wishlist</a>`);
  const unp = items.filter((x) => x.value == null).length;
  if (unp) kp.push(`<span><b>${unp}</b> sans cote</span>`);
  $('#dKpis', root).innerHTML = kp.join('');

  const empty = !S.cards.length && !S.sealed.length && !S.sales.length;
  $('#dMain', root).hidden = $('#dGrid', root).hidden = $('#dChartP', root).hidden = $('#dFilt', root).hidden = empty;
  $('#dEmpty', root).hidden = !empty;
  $('#dSub', root).innerHTML = empty ? 'Bienvenue dans Farde.' : `${cnt.loose + cnt.graded} carte${cnt.loose + cnt.graded > 1 ? 's' : ''} (dont ${cnt.graded} gradée${cnt.graded > 1 ? 's' : ''}), ${cnt.sealed} produit${cnt.sealed > 1 ? 's' : ''} scellé${cnt.sealed > 1 ? 's' : ''}.`;

  const j = S.lastJob;
  $('#dJob', root).innerHTML = j
    ? `<span class="pill ${j.ok ? 'ok' : j.ok === false ? 'err' : 'al'}">${j.ok ? 'Cotes à jour' : j.ok === false ? 'Dernière mise à jour en échec' : 'Mise à jour en cours'}</span><span>${frDateTime(j.finished_at || j.started_at)}</span>`
    : `<span class="pill al">Mise à jour automatique pas encore lancée</span>`;

  // Top hausses / chutes de valeur sur 30 jours
  const withChg = items.filter((x) => x.chg != null && Math.abs(x.chg) >= 0.01);
  const row = (x) => `<div class="it" data-item="${x.kind === 'sealed' ? 'sealed' : 'card'}|${x.id}">${x.img}<div style="min-width:0"><div class="ellip">${esc(x.name)}</div><div class="muted small ellip">${esc(x.sub)}</div></div>
    <div class="num mvv"><b class="${plClass(x.chg)}">${signEur(x.chg)}</b><span class="${plClass(x.chg)}">${pct(x.chgPct)}</span><span class="muted" title="Plus-value latente de la ligne (valeur moins prix d’achat)">PV ${x.pl != null ? `<span class="${plClass(x.pl)}">${signEur(x.pl)}</span>` : '—'}</span></div></div>`;
  const up = withChg.filter((x) => x.chg > 0).sort((a, b) => b.chg - a.chg).slice(0, 5);
  const down = withChg.filter((x) => x.chg < 0).sort((a, b) => a.chg - b.chg).slice(0, 5);
  const none = (w) => `<div class="empty">${items.length ? `Aucune ${w} sur 30 jours${filter !== 'all' ? ' dans ce filtre' : ''}.` : 'Rien dans ce filtre.'}</div>`;
  $('#dUp', root).innerHTML = up.length ? up.map(row).join('') : none('hausse');
  $('#dDown', root).innerHTML = down.length ? down.map(row).join('') : none('baisse');
  $('#dNote', root).textContent = withChg.some((x) => x.src === 'avg')
    ? 'Variation 30 jours : cote du jour comparée à la moyenne des 30 derniers jours sur Cardmarket, en attendant 30 jours d’historique propre à ta collection. « PV » = plus-value latente de la ligne (valeur moins prix d’achat).'
    : withChg.length ? 'Variation 30 jours calculée sur l’historique de tes cotes. « PV » = plus-value latente de la ligne.' : '';

  // Courbe
  const key = filter === 'sealed' ? 'sealed_value' : filter === 'all' ? 'value' : 'cards_value';
  const rows = S.history.map((h) => ({ d: h.d, value: h[key] != null ? Number(h[key]) : null, invested: filter === 'all' ? Number(h.invested) : null }));
  const series = [{ key: 'value', color: 'var(--accent)', area: true }];
  if (filter === 'all') series.push({ key: 'invested', color: 'var(--muted)', dashed: true });
  const svg = lineChart(rows, series, { label: 'Évolution de la valeur' });
  $('#dChartT', root).textContent = filter === 'all' ? 'Évolution de la valeur' : filter === 'sealed' ? 'Évolution · scellés' : 'Évolution · toutes les cartes';
  $('#dChart', root).innerHTML = svg
    ? `${svg}<div class="chart-legend"><span><b style="color:var(--accent)">━</b> Valeur</span>${filter === 'all' ? '<span>┅ Investi</span>' : ''}</div>`
    : `<div class="empty">La courbe apparaît à partir du deuxième jour. Un point est enregistré chaque matin par la mise à jour automatique.</div>`;
  $('#dRange', root).textContent = rows.length > 1 ? `${rows.length} jours suivis` : '';

  // Plus grosses valeurs + répartition
  const top = items.filter((x) => x.value != null).sort((a, b) => b.value - a.value).slice(0, 6);
  $('#dTop', root).innerHTML = top.length ? top.map((x) => `<div class="it" data-item="${x.kind === 'sealed' ? 'sealed' : 'card'}|${x.id}">${x.img}<div style="min-width:0"><div class="ellip">${esc(x.name)}</div><div class="muted small ellip">${esc(x.sub)}</div></div><div class="num" style="text-align:right">${eur(x.value)}<div class="${plClass(x.pl)} small">${x.pl != null ? signEur(x.pl) : ''}</div></div></div>`).join('') : `<div class="empty">Aucun item coté.</div>`;
  const by = {};
  const groupKey = filter === 'all' ? (x) => ({ loose: 'Cartes loose', graded: 'Cartes gradées', sealed: 'Scellés' }[x.kind]) : (x) => x.set;
  for (const x of items) if (x.value) by[groupKey(x)] = (by[groupKey(x)] || 0) + x.value;
  $('#dRepT', root).textContent = filter === 'all' ? 'Répartition par type' : filter === 'sealed' ? 'Répartition par type de produit' : 'Répartition par série';
  const arr = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 8), mx = arr[0]?.[1] || 1, tot = arr.reduce((a, x) => a + x[1], 0) || 1;
  $('#dSets', root).innerHTML = arr.length ? arr.map(([k, v]) => `<div class="b"><div style="min-width:0"><div class="ellip">${esc(k)} <span class="muted small">${Math.round((v / tot) * 100)} %</span></div><div class="track"><i style="width:${Math.max(2, (v / mx) * 100)}%"></i></div></div><div class="num" style="text-align:right">${eur(v)}</div></div>`).join('') : `<div class="empty">Rien à répartir.</div>`;
}
