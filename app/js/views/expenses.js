// Dépenses : ouvertures de boosters, lots, frais. Elles comptent dans l'investi, donc dans la plus-value.
import { S, addExpense, updateExpense, deleteExpense, expenseStats } from '../store.js';
import { esc, eur, signEur, pct, plClass, openDialog, closeDialog, toast, num, today, frDate, cardImg, confirmButton, $ } from '../ui.js';

const KINDS = { ouverture: 'Ouverture de boosters', lot: 'Achat d’un lot', frais: 'Frais (port, gradation…)', autre: 'Autre' };
let root;

export function render(el) {
  el.innerHTML = `<section class="view">
    <div class="vh"><div><h2>Dépenses</h2><p>Ce que tu as dépensé sans le répartir carte par carte : ouvertures de displays, lots, frais de port ou de gradation. Ces montants s’ajoutent à ton investi et viennent en déduction de ta plus-value.</p></div>
      <button class="btn pri" id="eAdd">Ajouter une dépense</button></div>
    <div class="panel" id="eSum"></div>
    <div id="eList" class="stack"></div>
    <p class="note">Astuce : après une ouverture, va dans Collection › <a href="#ajout">Ajout rapide</a>, choisis l’ouverture puis ajoute tes cartes à la chaîne (par série ou au scan). Tu peux aussi sélectionner des cartes dans la Liste et les rattacher d’un coup.</p>
  </section>`;
  root = el.firstElementChild;
  $('#eAdd', root).onclick = () => editDialog(null);
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit]'); if (b) editDialog(S.expenses.find((x) => x.id === b.dataset.edit));
  });
  update();
}

export function update() {
  if (!root?.isConnected) return;
  const stats = S.expenses.map((e) => ({ e, s: expenseStats(e) }));
  const spent = S.expenses.reduce((a, e) => a + Number(e.amount), 0);
  const opened = stats.filter((x) => x.s.count);
  const val = opened.reduce((a, x) => a + x.s.value, 0), cost = opened.reduce((a, x) => a + x.s.cost, 0);
  $('#eSum', root).innerHTML = S.expenses.length ? `<div class="row" style="gap:28px">
      <div><div class="lbl">Total dépensé</div><div class="kpi">${eur(spent)}</div></div>
      <div><div class="lbl">Valeur des cartes rattachées</div><div class="kpi">${eur(val)}</div></div>
      <div><div class="lbl">Résultat des ouvertures rattachées</div><div class="kpi ${plClass(val - cost)}">${signEur(val - cost)}</div></div>
    </div>` : `<div class="empty" style="border:0;padding:12px">Aucune dépense. Ajoute par exemple « Display Flammes Fantasmagoriques, 2 000 € ».</div>`;
  $('#eList', root).innerHTML = stats.map(({ e, s }) => {
    const cards = S.cards.filter((c) => c.expense_id === e.id).slice(0, 12);
    return `<div class="panel stack exp">
      <div class="row between">
        <div><h3>${esc(e.label)}</h3><div class="sub">${esc(KINDS[e.kind] || e.kind)} · ${frDate(e.d)}${e.notes ? ' · ' + esc(e.notes) : ''}</div></div>
        <div class="row"><a class="btn sm" href="#ajout?exp=${e.id}">Ajouter des cartes</a><button class="btn sm" data-edit="${e.id}">Modifier</button></div>
      </div>
      <div class="row" style="gap:28px">
        <div><div class="lbl">Montant</div><b class="num">${eur(e.amount)}</b></div>
        <div><div class="lbl">Cartes rattachées</div><b class="num">${s.count}${s.sold ? ` <span class="muted small">dont ${s.sold} vendue${s.sold > 1 ? 's' : ''}</span>` : ''}</b></div>
        <div><div class="lbl">${s.sold ? 'Valeur + ventes' : 'Leur valeur'}</div><b class="num">${eur(s.value)}</b></div>
        <div><div class="lbl">Résultat</div><b class="num ${plClass(s.result)}">${s.count ? `${signEur(s.result)} (${pct(s.pct)})` : '—'}</b></div>
      </div>
      ${cards.length ? `<div class="row" style="gap:6px">${cards.map((c) => `<span title="${esc(c.name)}">${cardImg(c.image, c.name, 'thumb')}</span>`).join('')}${s.count > 12 ? `<span class="muted small">+${s.count - 12}</span>` : ''}</div>` : ''}
    </div>`;
  }).join('');
}

export const openExpenseDialog = (e, onSaved) => editDialog(e, onSaved);
function editDialog(e, onSaved) {
  const x = e || { label: '', kind: 'ouverture', amount: null, d: today(), notes: '' };
  const d = openDialog(`<div class="mhead"><h3>${e ? 'Modifier la dépense' : 'Nouvelle dépense'}</h3><button class="btn sm" data-close aria-label="Fermer">✕</button></div>
    <form class="mbody" id="ef">
      <div class="field"><label for="eL">Libellé</label><input id="eL" type="text" required maxlength="120" value="${esc(x.label)}" placeholder="Display Flammes Fantasmagoriques, lot vintage brocante…"></div>
      <div class="fgrid">
        <div class="field"><label for="eK">Type</label><select id="eK">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${k === x.kind ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label for="eA">Montant (€)</label><input id="eA" type="number" min="0" step="0.01" inputmode="decimal" required value="${x.amount ?? ''}"></div>
        <div class="field"><label for="eD">Date</label><input id="eD" type="date" required value="${esc(x.d)}"></div>
      </div>
      <div class="field"><label for="eN">Notes</label><input id="eN" type="text" value="${esc(x.notes || '')}" placeholder="Acheté chez…"></div>
      <div class="row between"><div>${e ? '<button type="button" class="btn dng" id="eDel">Supprimer</button>' : ''}</div>
        <div class="row"><button type="button" class="btn" data-close>Annuler</button><button class="btn pri" id="eSave">${e ? 'Enregistrer' : 'Ajouter la dépense'}</button></div></div>
    </form>`);
  $('#eL', d).focus();
  $('#ef', d).onsubmit = async (ev) => {
    ev.preventDefault();
    const data = { label: $('#eL', d).value.trim(), kind: $('#eK', d).value, amount: num($('#eA', d).value) ?? 0, d: $('#eD', d).value || today(), notes: $('#eN', d).value.trim() || null };
    $('#eSave', d).disabled = true;
    try { const r = e ? await updateExpense(e.id, data) : await addExpense(data); closeDialog(); toast(e ? 'Dépense enregistrée.' : 'Dépense ajoutée.'); onSaved?.(r); }
    catch (err) { toast(err.message, 5000); $('#eSave', d).disabled = false; }
  };
  const del = $('#eDel', d);
  if (del) del.onclick = async () => {
    if (!confirmButton(del, 'Confirmer : les cartes restent dans ta collection')) return;
    try { await deleteExpense(e.id); closeDialog(); toast('Dépense supprimée.'); } catch (err) { toast(err.message, 5000); }
  };
}
