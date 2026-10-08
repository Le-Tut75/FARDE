import { S, totals, calcLine, calcSealed } from '../store.js';
import { openCard } from '../carddialog.js';
import { sealedImg, sealedImage } from './sealed.js';
import { esc, eur, signEur, pct, plClass, cardImg, lineChart, frDateTime, $, $$ } from '../ui.js';

let root, period = '7';
export function render(el) {
  el.innerHTML = `<section class="view">
    <div class="vh"><div><h2>Portefeuille</h2><p id="dSub"></p></div><div class="status" id="dJob"></div></div>
    <div class="hero">
      <div class="worth">
        <div><div class="lbl">Valeur totale</div><div class="big" id="dValue">0 €</div></div>
        <div class="split">
          <div><span class="lbl">Investi</span><b id="dInv"></b><span class="lbl small" id="dSpent"></span></div>
          <div><span class="lbl">Plus-value</span><b id="dPL"></b></div>
          <div><span class="lbl">Rendement</span><b id="dPct"></b></div>
        </div>
        <div class="split">
          <div><span class="lbl">Cartes</span><b id="dCards"></b></div>
          <div><span class="lbl">Scellés</span><b id="dSealed"></b></div>
          <div><span class="lbl">Dont réalisée</span><b id="dReal"></b></div>
        </div>
      </div>
      <div class="panel chart"><div class="row between"><h3>Évolution de la valeur</h3><span class="muted small" id="dRange"></span></div><div id="dChart"></div></div>
    </div>
    <div class="welcome" id="dWelcome" hidden>
      <div><h3>Bienvenue dans Farde</h3><p class="muted">Trois façons de remplir ta collection. Tu pourras toujours mélanger les trois.</p></div>
      <div class="wgrid">
        <a class="wbtn" href="#import"><svg><use href="#i-upload"/></svg><b>Importer mon tableur</b><span>Google Sheets, Excel ou CSV : tout est reconnu automatiquement.</span></a>
        <a class="wbtn" href="#ajout?mode=scan"><svg><use href="#i-scan"/></svg><b>Scanner mes cartes</b><span>L’appareil photo lit le numéro en bas de la carte.</span></a>
        <a class="wbtn" href="#catalogue"><svg><use href="#i-search"/></svg><b>Chercher une carte</b><span>Toutes les cartes, toutes les langues, avec leur cote.</span></a>
      </div>
    </div>
    <div class="grid2" id="dGrid">
      <div class="panel"><div class="row between" style="margin-bottom:8px"><h3>Variations de cote</h3><div class="tabs" id="dMovTabs"><button type="button" data-p="7" aria-pressed="true">7 jours</button><button type="button" data-p="30" aria-pressed="false">30 jours</button></div></div><div class="toplist" id="dVar"></div></div>
      <div class="panel"><h3 style="margin-bottom:8px">Cartes les plus cotées</h3><div class="toplist" id="dTop"></div></div>
      <div class="panel"><h3 style="margin-bottom:8px">Meilleures et pires plus-values</h3><div class="toplist" id="dMovers"></div></div>
      <div class="panel"><h3 style="margin-bottom:8px">Répartition par série</h3><div class="bars" id="dSets"></div></div>
      <div class="panel"><h3 style="margin-bottom:8px">Scellés</h3><div class="toplist" id="dSealedList"></div></div>
    </div>
  </section>`;
  root = el.firstElementChild;
  root.addEventListener('click', (e) => {
    const tb = e.target.closest('#dMovTabs [data-p]');
    if (tb) { period = tb.dataset.p; update(); return; }
    const mv = e.target.closest('[data-mover]');
    if (mv) { const [lang, id] = mv.dataset.mover.split('|'); const l = S.cards.find((c) => c.lang === lang && c.card_id === id); openCard(lang, id, l ? { line: l } : {}); return; }
    const it = e.target.closest('[data-card]');
    if (it) { const l = S.cards.find((c) => c.id === it.dataset.card); if (l) openCard(l.lang, l.card_id, { line: l }); }
  });
  update();
}

export function update() {
  if (!root) return;
  const t = totals();
  $('#dValue', root).textContent = eur(t.value);
  $('#dInv', root).textContent = eur(t.invested);
  $('#dSpent', root).innerHTML = t.spent ? `dont <a href="#depenses" style="color:inherit">${eur(t.spent)} de dépenses</a>` : '';
  const pl = $('#dPL', root); pl.textContent = signEur(t.pl); pl.className = t.pl >= 0 ? 'pos' : 'neg';
  const p = $('#dPct', root); p.textContent = t.invested ? pct(t.pct) : '—'; p.className = t.pl >= 0 ? 'pos' : 'neg';
  $('#dCards', root).textContent = t.count.toLocaleString('fr-FR');
  $('#dSealed', root).textContent = eur(t.sealedValue);
  const re = $('#dReal', root);
  re.innerHTML = t.salesCount ? `<a href="#ventes" style="color:inherit">${signEur(t.realized)}</a>` : '<a href="#ventes" style="color:inherit;font-weight:500" class="small">aucune vente</a>';
  re.className = t.realized > 0 ? 'pos' : t.realized < 0 ? 'neg' : '';
  const empty = !S.cards.length && !S.sealed.length && !S.sales.length;
  $('#dWelcome', root).hidden = !empty; $('#dGrid', root).hidden = empty;
  $('#dSub', root).innerHTML = !empty
    ? `${S.cards.length.toLocaleString('fr-FR')} lignes de cartes, ${S.sealed.length} scellé${S.sealed.length > 1 ? 's' : ''}${t.toCheck ? ` · <a href="#collection?type=check">${t.toCheck} à coter à la main</a>` : ''}${t.alerts ? ` · <a href="#wishlist">${t.alerts} alerte${t.alerts > 1 ? 's' : ''} wishlist</a>` : ''}.`
    : 'Ta collection est vide pour l’instant.';
  drawVariations();

  const j = S.lastJob;
  $('#dJob', root).innerHTML = j
    ? `<span class="pill ${j.ok ? 'ok' : j.ok === false ? 'err' : 'al'}">${j.ok ? 'Cotes à jour' : j.ok === false ? 'Dernière mise à jour en échec' : 'Mise à jour en cours'}</span><span>${frDateTime(j.finished_at || j.started_at)}</span>`
    : `<span class="pill al">Mise à jour automatique pas encore lancée</span>`;

  // Courbe
  const rows = S.history.map((h) => ({ d: h.d, value: Number(h.value), invested: Number(h.invested) }));
  const svg = lineChart(rows, [{ key: 'value', color: 'var(--accent)', area: true }, { key: 'invested', color: 'var(--muted)', dashed: true }], { label: 'Évolution de la valeur du portefeuille' });
  $('#dChart', root).innerHTML = svg
    ? `${svg}<div class="chart-legend"><span><b style="color:var(--accent)">━</b> Valeur</span><span>┅ Investi</span></div>`
    : `<div class="empty">La courbe apparaît à partir du deuxième jour. Un point est enregistré chaque matin par la mise à jour automatique.</div>`;
  $('#dRange', root).textContent = rows.length > 1 ? `${rows.length} jours suivis` : '';

  // Top valeur
  const lines = S.cards.map((l) => ({ l, c: calcLine(l) })).filter((x) => x.c.value != null);
  const item = ({ l, c }, right) => `<div class="it" data-card="${l.id}">${cardImg(l.image, l.name, 'thumb')}<div style="min-width:0"><div class="ellip">${esc(l.name)} <span class="muted">${esc(l.local_id || '')}</span></div>
    <div class="muted small ellip">${esc(l.set_name || '')} · ${esc(l.lang.toUpperCase())} · ${l.grading_company ? esc(`${l.grading_company} ${l.grade || ''}`) : esc(l.condition)}${l.qty > 1 ? ' · ×' + l.qty : ''}</div></div>${right}</div>`;
  const top = [...lines].sort((a, b) => b.c.value - a.c.value).slice(0, 8);
  $('#dTop', root).innerHTML = top.length ? top.map((x) => item(x, `<div class="num" style="text-align:right">${eur(x.c.value)}<div class="${plClass(x.c.pl)} small">${x.c.pl != null ? signEur(x.c.pl) : ''}</div></div>`)).join('') : `<div class="empty">Aucune carte cotée pour l’instant.</div>`;

  const withPl = lines.filter((x) => x.c.pl != null).sort((a, b) => b.c.pl - a.c.pl);
  const movers = withPl.length > 8 ? [...withPl.slice(0, 4), ...withPl.slice(-4)] : withPl;
  $('#dMovers', root).innerHTML = movers.length ? movers.map((x) => item(x, `<div class="num ${plClass(x.c.pl)}" style="text-align:right">${signEur(x.c.pl)}<div class="small">${x.c.invested ? pct((x.c.pl / x.c.invested) * 100) : ''}</div></div>`)).join('') : `<div class="empty">Renseigne tes prix d’achat pour voir tes plus-values.</div>`;

  const by = {};
  for (const x of lines) { const k = x.l.set_name || 'Sans série'; by[k] = (by[k] || 0) + x.c.value; }
  const arr = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 8), mx = arr[0]?.[1] || 1;
  $('#dSets', root).innerHTML = arr.length ? arr.map(([k, v]) => `<div class="b"><div style="min-width:0"><div class="ellip">${esc(k)}</div><div class="track"><i style="width:${Math.max(2, (v / mx) * 100)}%"></i></div></div><div class="num" style="text-align:right">${eur(v)}</div></div>`).join('') : `<div class="empty">Rien à répartir.</div>`;

  const sl = S.sealed.map((s) => ({ s, c: calcSealed(s) })).sort((a, b) => (b.c.value || 0) - (a.c.value || 0)).slice(0, 6);
  $('#dSealedList', root).innerHTML = sl.length ? sl.map(({ s, c }) => `<a class="it" href="#scelles" style="color:inherit;text-decoration:none">${sealedImg(sealedImage(s), s.name, 'sthumb')}<div style="min-width:0"><div class="ellip">${esc(s.name)}</div><div class="muted small">${esc(s.category || '')} · ×${s.qty}</div></div><div class="num" style="text-align:right">${eur(c.value)}<div class="${plClass(c.pl)} small">${c.pl != null ? signEur(c.pl) : ''}</div></div></a>`).join('') : `<div class="empty">Aucun scellé. Ajoute tes displays et ETB dans l’onglet Scellés.</div>`;
}

/** Cartes de la collection dont la cote a le plus bougé (calculé chaque matin par la mise à jour). */
function drawVariations() {
  $$('#dMovTabs [data-p]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === period)));
  const key = period === '7' ? 'price7' : 'price30';
  const rows = S.movers.filter((m) => m[key] != null && Number(m[key]) > 0 && m.price != null)
    .map((m) => ({ m, chg: (Number(m.price) - Number(m[key])) / Number(m[key]) * 100, eu: (Number(m.price) - Number(m[key])) * (m.qty || 1) }))
    .filter((x) => Math.abs(x.chg) >= 0.5);
  const up = rows.filter((x) => x.eu > 0).sort((a, b) => b.eu - a.eu).slice(0, 4);
  const down = rows.filter((x) => x.eu < 0).sort((a, b) => a.eu - b.eu).slice(0, 4);
  const it = ({ m, chg, eu }) => `<div class="it" data-mover="${esc(m.lang)}|${esc(m.card_id)}">${cardImg(m.image, m.name, 'thumb')}<div style="min-width:0"><div class="ellip">${esc(m.name)} <span class="muted">${esc(m.local_id || '')}</span></div>
    <div class="muted small ellip">${esc(m.set_name || '')} · ${eur(m[key])} → ${eur(m.price)}${m.qty > 1 ? ' · ×' + m.qty : ''}</div></div>
    <div class="num ${plClass(chg)}" style="text-align:right">${pct(chg)}<div class="small">${signEur(eu)}</div></div></div>`;
  $('#dVar', root).innerHTML = up.length || down.length ? [...up, ...down].map(it).join('')
    : `<div class="empty">${S.cards.length ? `Les variations apparaissent après ${period} jours de suivi : la mise à jour du matin enregistre la cote de chaque carte.` : 'Ajoute des cartes pour suivre leurs variations.'}</div>`;
}
