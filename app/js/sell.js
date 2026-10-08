// Vente d'une carte ou d'un scellé : la plus-value devient « réalisée ».
import { S, sellLine, calcLine, calcSealed } from './store.js';
import { saleCalc, variantLabel } from './valuation.js';
import { esc, eur, signEur, plClass, openDialog, closeDialog, toast, num, today, $ } from './ui.js';

/** kind : 'card' ou 'sealed' ; line : ligne de collection ou de scellés */
export function openSell(kind, line, { onDone } = {}) {
  const c = kind === 'card' ? calcLine(line) : calcSealed(line);
  const sub = kind === 'card'
    ? `${esc(line.set_name || '')} · ${esc(line.local_id || '')} · ${esc((line.lang || '').toUpperCase())}${line.variant && line.variant !== 'normal' ? ' · ' + esc(variantLabel(line.variant)) : ''}`
    : `${esc(line.category || '')} · ${esc((line.lang || '').toUpperCase())}`;
  const d = openDialog(`<div class="mhead"><h3>Vendre : ${esc(line.name)}</h3><button class="btn sm" data-close aria-label="Fermer">✕</button></div>
    <form class="mbody" id="slf">
      <p class="note">${sub} · tu en as ${line.qty}${line.buy_price != null ? `, achetée${line.qty > 1 ? 's' : ''} ${eur(line.buy_price)} pièce` : ''}${c.unit != null ? ` · cote actuelle ${eur(c.unit)}` : ''}.</p>
      <div class="fgrid">
        <div class="field"><label for="slQ">Quantité vendue</label><input id="slQ" type="number" min="1" max="${line.qty}" step="1" value="1" required></div>
        <div class="field"><label for="slP">Prix de vente unitaire (€)</label><input id="slP" type="number" min="0" step="0.01" inputmode="decimal" required value="${c.unit ?? ''}"></div>
        <div class="field"><label for="slF">Frais totaux (€)</label><input id="slF" type="number" min="0" step="0.01" inputmode="decimal" placeholder="port, commission…"></div>
        <div class="field"><label for="slD">Date</label><input id="slD" type="date" required value="${today()}"></div>
        <div class="field" style="grid-column:span 2"><label for="slN">Où / à qui</label><input id="slN" type="text" placeholder="Cardmarket, Vinted, échange avec…"></div>
      </div>
      <div class="panel" style="background:var(--ground);padding:14px" id="slPrev"></div>
      <div class="row end"><button type="button" class="btn" data-close>Annuler</button><button class="btn pri" id="slSave">Enregistrer la vente</button></div>
    </form>`);
  const read = () => ({ qty: Math.max(1, Math.min(line.qty, parseInt($('#slQ', d).value, 10) || 1)), price: num($('#slP', d).value) ?? 0, fees: num($('#slF', d).value) ?? 0, d: $('#slD', d).value || today(), notes: $('#slN', d).value.trim() || null });
  const prev = () => {
    const x = read();
    const r = saleCalc({ ...x, cost: line.buy_price != null ? Number(line.buy_price) * x.qty : 0 });
    const fromExp = kind === 'card' && line.expense_id ? S.expenses.find((e) => e.id === line.expense_id) : null;
    $('#slPrev', d).innerHTML = `<div class="row" style="gap:26px">
      <div><div class="lbl">Tu encaisses</div><b class="kpi">${eur(r.net)}</b></div>
      <div><div class="lbl">Prix d’achat</div><b class="kpi">${line.buy_price != null ? eur(r.cost) : '—'}</b></div>
      <div><div class="lbl">Plus-value réalisée</div><b class="kpi ${plClass(r.pl)}">${signEur(r.pl)}</b></div></div>
      ${fromExp ? `<p class="note" style="margin-top:8px">Carte tirée de « ${esc(fromExp.label)} » : la vente s’ajoute au résultat de cette ouverture.</p>` : line.buy_price == null ? '<p class="note" style="margin-top:8px">Pas de prix d’achat : toute la vente compte comme plus-value.</p>' : ''}
      ${x.qty < line.qty ? `<p class="note" style="margin-top:8px">Il t’en restera ${line.qty - x.qty}.</p>` : ''}`;
  };
  $('#slf', d).addEventListener('input', prev); prev();
  $('#slP', d).select();
  $('#slf', d).onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#slSave', d); btn.disabled = true;
    try {
      const x = read();
      await sellLine(kind, line, x);
      closeDialog();
      toast(`Vente enregistrée : ${signEur(saleCalc({ ...x, cost: line.buy_price != null ? Number(line.buy_price) * x.qty : 0 }).pl)} de plus-value réalisée.`, 4500);
      onDone?.();
    } catch (err) { toast(err.message, 5000); btn.disabled = false; }
  };
}
