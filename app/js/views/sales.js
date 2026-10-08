// Ventes : ce que tu as vendu et la plus-value réalisée.
import { S, undoSale, updateSale } from '../store.js';
import { saleCalc, variantLabel } from '../valuation.js';
import { sealedImg } from './sealed.js';
import { esc, eur, signEur, pct, plClass, cardImg, frDate, toast, download, toCsv, csvNum, today, confirmButton, openDialog, closeDialog, num, $ } from '../ui.js';

let root;
const st = { year: '' };

export function render(el) {
  el.innerHTML = `<section class="view">
    <div class="vh"><div><h2>Ventes</h2><p>Pour vendre une carte ou un scellé, ouvre sa fiche et clique sur « Vendre ». La plus-value réalisée s’ajoute à ton résultat global.</p></div>
      <div class="row"><select id="vYear" aria-label="Année" style="width:auto"></select><button class="btn" id="vCsv">Exporter en CSV</button></div></div>
    <div class="panel" id="vSum"></div>
    <div class="tw"><table class="resp nochk" id="vTable"><thead><tr><th></th><th>Article</th><th>Date</th><th class="r">Qté</th><th class="r">Prix u.</th><th class="r">Frais</th><th class="r">Encaissé</th><th class="r">Achat</th><th class="r">Plus-value</th></tr></thead><tbody></tbody></table></div>
  </section>`;
  root = el.firstElementChild;
  $('#vYear', root).onchange = (e) => { st.year = e.target.value; update(); };
  $('#vCsv', root).onclick = exportCsv;
  $('#vTable tbody', root).addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) { const s = S.sales.find((x) => x.id === tr.dataset.id); if (s) editDialog(s); }
  });
  update();
}

const list = () => S.sales.filter((s) => !st.year || String(s.d).startsWith(st.year));

export function update() {
  if (!root?.isConnected) return;
  const years = [...new Set(S.sales.map((s) => String(s.d).slice(0, 4)))].sort().reverse();
  $('#vYear', root).innerHTML = `<option value="">Toutes les années</option>` + years.map((y) => `<option ${y === st.year ? 'selected' : ''}>${y}</option>`).join('');
  $('#vYear', root).hidden = years.length < 2;
  const L = list().map((s) => ({ s, c: saleCalc(s) }));
  const net = L.reduce((a, x) => a + x.c.net, 0), cost = L.reduce((a, x) => a + x.c.cost, 0), pl = net - cost, n = L.reduce((a, x) => a + x.s.qty, 0);
  $('#vSum', root).innerHTML = S.sales.length ? `<div class="row" style="gap:28px">
      <div><div class="lbl">Articles vendus</div><div class="kpi">${n}</div></div>
      <div><div class="lbl">Encaissé (frais déduits)</div><div class="kpi">${eur(net)}</div></div>
      <div><div class="lbl">Prix d’achat</div><div class="kpi">${eur(cost)}</div></div>
      <div><div class="lbl">Plus-value réalisée</div><div class="kpi ${plClass(pl)}">${signEur(pl)}${cost ? ` <span class="small">${pct((pl / cost) * 100)}</span>` : ''}</div></div>
    </div>` : `<div class="empty" style="border:0;padding:12px">Aucune vente enregistrée. Ouvre une carte de ta collection et clique sur « Vendre ».</div>`;
  $('#vTable tbody', root).innerHTML = L.map(({ s, c }) => `<tr data-id="${s.id}" style="cursor:pointer">
    <td class="c-img">${s.kind === 'sealed' ? sealedImg(s.image, s.name, 'sthumb') : cardImg(s.image, s.name, 'thumb')}</td>
    <td class="c-main"><b>${esc(s.name)}</b> <span class="muted small num">${esc(s.local_id || '')}</span><div class="sub">${esc(s.set_name || '')}${s.variant && s.variant !== 'normal' ? ' · ' + esc(variantLabel(s.variant)) : ''}${s.notes ? ' · ' + esc(s.notes) : ''}</div></td>
    <td class="c-meta c-meta-sm sub">${frDate(s.d)} · ×${s.qty} à ${eur(s.price)}${Number(s.fees) ? ' · frais ' + eur(s.fees) : ''}</td>
    <td class="hide-sm">${frDate(s.d)}</td><td class="r num hide-sm">${s.qty}</td><td class="r num hide-sm">${eur(s.price)}</td><td class="r num hide-sm">${Number(s.fees) ? eur(s.fees) : '—'}</td>
    <td class="r num c-val"><b>${eur(c.net)}</b></td><td class="r num hide-sm">${s.cost != null ? eur(s.cost) : '—'}</td>
    <td class="r num c-pl ${plClass(c.pl)}">${signEur(c.pl)}</td></tr>`).join('') || (S.sales.length ? `<tr><td colspan="9"><div class="empty">Aucune vente cette année-là.</div></td></tr>` : '');
  $('#vTable', root).closest('.tw').hidden = !S.sales.length;
}

function editDialog(s) {
  const d = openDialog(`<div class="mhead"><h3>Vente : ${esc(s.name)}</h3><button class="btn sm" data-close aria-label="Fermer">✕</button></div>
    <form class="mbody" id="vf">
      <div class="fgrid">
        <div class="field"><label for="vP">Prix de vente unitaire (€)</label><input id="vP" type="number" min="0" step="0.01" required value="${s.price}"></div>
        <div class="field"><label for="vF">Frais totaux (€)</label><input id="vF" type="number" min="0" step="0.01" value="${s.fees ?? 0}"></div>
        <div class="field"><label for="vD">Date</label><input id="vD" type="date" required value="${esc(s.d)}"></div>
        <div class="field"><label for="vC">Prix d’achat total (€)</label><input id="vC" type="number" min="0" step="0.01" value="${s.cost ?? ''}" placeholder="inconnu"></div>
        <div class="field" style="grid-column:span 2"><label for="vN">Où / à qui</label><input id="vN" type="text" value="${esc(s.notes || '')}"></div>
      </div>
      <div class="row between"><button type="button" class="btn dng" id="vUndo">Annuler la vente</button>
        <div class="row"><button type="button" class="btn" data-close>Fermer</button><button class="btn pri" id="vSave">Enregistrer</button></div></div>
      <p class="note">« Annuler la vente » remet ${s.qty > 1 ? `les ${s.qty} exemplaires` : 'l’exemplaire'} dans ta collection, comme avant la vente.</p>
    </form>`);
  $('#vf', d).onsubmit = async (e) => {
    e.preventDefault();
    try {
      await updateSale(s.id, { price: num($('#vP', d).value) ?? 0, fees: num($('#vF', d).value) ?? 0, d: $('#vD', d).value, cost: num($('#vC', d).value), notes: $('#vN', d).value.trim() || null });
      closeDialog(); toast('Vente modifiée.');
    } catch (err) { toast(err.message, 5000); }
  };
  $('#vUndo', d).onclick = async (e) => {
    if (!confirmButton(e.target, 'Confirmer l’annulation')) return;
    try { await undoSale(s); closeDialog(); toast('Vente annulée : retour dans ta collection.'); } catch (err) { toast(err.message, 5000); }
  };
}

function exportCsv() {
  const H = ['Date', 'Type', 'Article', 'Numéro', 'Série', 'Version', 'Quantité', 'Prix unitaire', 'Frais', 'Encaissé', "Prix d'achat", 'Plus-value', 'Notes'];
  const rows = list().map((s) => { const c = saleCalc(s); return [s.d, s.kind === 'sealed' ? 'Scellé' : 'Carte', s.name, s.local_id, s.set_name, s.variant ? variantLabel(s.variant) : '', s.qty, csvNum(s.price), csvNum(s.fees), csvNum(c.net), csvNum(s.cost), csvNum(c.pl), s.notes]; });
  download(`farde-ventes-${today()}.csv`, toCsv(H, rows), 'text/csv;charset=utf-8');
}
