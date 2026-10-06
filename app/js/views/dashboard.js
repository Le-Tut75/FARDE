import { S, totals, calcLine, calcSealed } from '../store.js';
import { openCard } from '../carddialog.js';
import { esc, eur, signEur, pct, plClass, cardImg, lineChart, frDateTime, $ } from '../ui.js';

let root;
export function render(el) {
  el.innerHTML = `<section class="view">
    <div class="vh"><div><h2>Portefeuille</h2><p id="dSub"></p></div><div class="status" id="dJob"></div></div>
    <div class="hero">
      <div class="worth">
        <div><div class="lbl">Valeur totale</div><div class="big" id="dValue">0 €</div></div>
        <div class="split">
          <div><span class="lbl">Investi</span><b id="dInv"></b></div>
          <div><span class="lbl">Plus-value</span><b id="dPL"></b></div>
          <div><span class="lbl">Rendement</span><b id="dPct"></b></div>
        </div>
        <div class="split">
          <div><span class="lbl">Cartes</span><b id="dCards"></b></div>
          <div><span class="lbl">Scellés</span><b id="dSealed"></b></div>
          <div><span class="lbl">Alertes wishlist</span><b id="dAlerts"></b></div>
        </div>
      </div>
      <div class="panel chart"><div class="row between"><h3>Évolution de la valeur</h3><span class="muted small" id="dRange"></span></div><div id="dChart"></div></div>
    </div>
    <div class="grid2">
      <div class="panel"><h3 style="margin-bottom:8px">Cartes les plus cotées</h3><div class="toplist" id="dTop"></div></div>
      <div class="panel"><h3 style="margin-bottom:8px">Meilleures et pires plus-values</h3><div class="toplist" id="dMovers"></div></div>
      <div class="panel"><h3 style="margin-bottom:8px">Répartition par série</h3><div class="bars" id="dSets"></div></div>
      <div class="panel"><h3 style="margin-bottom:8px">Scellés</h3><div class="toplist" id="dSealedList"></div></div>
    </div>
  </section>`;
  root = el.firstElementChild;
  root.addEventListener('click', (e) => {
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
  const pl = $('#dPL', root); pl.textContent = signEur(t.pl); pl.className = t.pl >= 0 ? 'pos' : 'neg';
  const p = $('#dPct', root); p.textContent = t.invested ? pct(t.pct) : '—'; p.className = t.pl >= 0 ? 'pos' : 'neg';
  $('#dCards', root).textContent = t.count.toLocaleString('fr-FR');
  $('#dSealed', root).textContent = eur(t.sealedValue);
  $('#dAlerts', root).textContent = t.alerts;
  $('#dSub', root).textContent = S.cards.length || S.sealed.length
    ? `${S.cards.length.toLocaleString('fr-FR')} lignes de cartes, ${S.sealed.length} scellé${S.sealed.length > 1 ? 's' : ''}${t.unpriced ? ` · ${t.unpriced} carte${t.unpriced > 1 ? 's' : ''} sans cote` : ''}.`
    : 'Ajoute des cartes depuis le Catalogue ou importe ton tableur pour démarrer.';

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
  $('#dSealedList', root).innerHTML = sl.length ? sl.map(({ s, c }) => `<a class="it" href="#scelles" style="color:inherit;text-decoration:none"><div class="thumb ph"></div><div style="min-width:0"><div class="ellip">${esc(s.name)}</div><div class="muted small">${esc(s.category || '')} · ×${s.qty}</div></div><div class="num" style="text-align:right">${eur(c.value)}<div class="${plClass(c.pl)} small">${c.pl != null ? signEur(c.pl) : ''}</div></div></a>`).join('') : `<div class="empty">Aucun scellé. Ajoute tes displays et ETB dans l’onglet Scellés.</div>`;
}
