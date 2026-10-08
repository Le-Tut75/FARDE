// Export Excel complet : une feuille par type de données, avec des formules (modifiables dans Excel).
import { S, calcLine, calcSealed, totals } from './store.js';
import { variantLabel, saleCalc } from './valuation.js';
import { today } from './ui.js';

const EUR = '#,##0.00 "€"';
const PCT = '0.0%';
const col = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

/**
 * Feuille à partir de colonnes { h: titre, w: largeur, v: (ligne) => valeur, f: (r) => formule, z: format }.
 * r = numéro de ligne Excel (2 pour la première ligne de données).
 */
function sheet(XLSX, columns, rows, { totalsRow = null } = {}) {
  const ws = {};
  columns.forEach((c, j) => { ws[col(j) + '1'] = { t: 's', v: c.h }; });
  rows.forEach((row, i) => {
    const r = i + 2;
    columns.forEach((c, j) => {
      const v = c.v ? c.v(row) : null;
      const cell = {};
      if (c.f) { cell.f = c.f(r); cell.t = 'n'; if (typeof v === 'number') cell.v = v; }
      else if (v == null || v === '') return;
      else if (typeof v === 'number') { cell.t = 'n'; cell.v = v; }
      else if (v instanceof Date) { cell.t = 'd'; cell.v = v; }
      else { cell.t = 's'; cell.v = String(v); }
      if (c.z) cell.z = c.z;
      ws[col(j) + r] = cell;
    });
  });
  let last = rows.length + 1;
  if (totalsRow && rows.length) {
    const r = rows.length + 3;
    columns.forEach((c, j) => {
      const t = totalsRow[c.h];
      if (t === 'label') ws[col(j) + r] = { t: 's', v: 'Total' };
      else if (t === 'sum') ws[col(j) + r] = { t: 'n', f: `SUM(${col(j)}2:${col(j)}${rows.length + 1})`, z: c.z };
    });
    last = r;
  }
  ws['!ref'] = `A1:${col(columns.length - 1)}${Math.max(1, last)}`;
  ws['!cols'] = columns.map((c) => ({ wch: c.w || 12 }));
  ws['!autofilter'] = { ref: `A1:${col(columns.length - 1)}${Math.max(1, rows.length + 1)}` };
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  return ws;
}
const n = (v) => (v == null || v === '' ? null : Number(v));

export async function exportExcel() {
  const XLSX = await import('./vendor/xlsx.js');
  const wb = XLSX.utils.book_new();
  const binder = (id) => S.binders.find((b) => b.id === id)?.name || '';
  const expense = (id) => S.expenses.find((e) => e.id === id)?.label || '';

  // Cartes : Valeur = Qté × Cote, Investi = Qté × Achat, Plus-value = Valeur − Investi
  const cards = S.cards.map((l) => ({ l, c: calcLine(l) })).sort((a, b) => (b.c.value || 0) - (a.c.value || 0));
  const C = [
    { h: 'Nom', w: 26, v: (x) => x.l.name }, { h: 'Numéro', w: 8, v: (x) => x.l.local_id }, { h: 'Série', w: 26, v: (x) => x.l.set_name },
    { h: 'Langue', w: 7, v: (x) => x.l.lang?.toUpperCase() }, { h: 'Version', w: 16, v: (x) => variantLabel(x.l.variant) }, { h: 'État', w: 6, v: (x) => x.l.condition },
    { h: 'Gradation', w: 10, v: (x) => (x.l.grading_company ? `${x.l.grading_company} ${x.l.grade || ''}`.trim() : '') },
    { h: 'Quantité', w: 9, v: (x) => x.l.qty }, { h: 'Achat unitaire', w: 13, z: EUR, v: (x) => n(x.l.buy_price) },
    { h: 'Cote unitaire', w: 13, z: EUR, v: (x) => x.c.unit },
    { h: 'Valeur', w: 12, z: EUR, v: (x) => x.c.value, f: (r) => `IF(J${r}="","",H${r}*J${r})` },
    { h: 'Investi', w: 12, z: EUR, v: (x) => x.c.invested, f: (r) => `IF(I${r}="",0,H${r}*I${r})` },
    { h: 'Plus-value', w: 12, z: EUR, v: (x) => x.c.pl, f: (r) => `IF(OR(I${r}="",J${r}=""),"",K${r}-L${r})` },
    { h: "Date d'achat", w: 12, v: (x) => x.l.buy_date }, { h: 'Farde', w: 14, v: (x) => binder(x.l.binder_id) }, { h: 'Ouverture / lot', w: 18, v: (x) => expense(x.l.expense_id) },
    { h: 'Notes', w: 20, v: (x) => x.l.notes }, { h: 'ID TCGdex', w: 14, v: (x) => x.l.card_id },
  ];
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, C, cards, { totalsRow: { Nom: 'label', Quantité: 'sum', Valeur: 'sum', Investi: 'sum', 'Plus-value': 'sum' } }), 'Cartes');

  const sealed = S.sealed.map((s) => ({ s, c: calcSealed(s) }));
  const SC = [
    { h: 'Produit', w: 40, v: (x) => x.s.name }, { h: 'Type', w: 12, v: (x) => x.s.category }, { h: 'Langue', w: 7, v: (x) => x.s.lang?.toUpperCase() },
    { h: 'Quantité', w: 9, v: (x) => x.s.qty }, { h: 'Achat unitaire', w: 13, z: EUR, v: (x) => n(x.s.buy_price) }, { h: 'Cote unitaire', w: 13, z: EUR, v: (x) => x.c.unit },
    { h: 'Valeur', w: 12, z: EUR, v: (x) => x.c.value, f: (r) => `IF(F${r}="","",D${r}*F${r})` },
    { h: 'Investi', w: 12, z: EUR, v: (x) => x.c.invested, f: (r) => `IF(E${r}="",0,D${r}*E${r})` },
    { h: 'Plus-value', w: 12, z: EUR, v: (x) => x.c.pl, f: (r) => `IF(OR(E${r}="",F${r}=""),"",G${r}-H${r})` },
    { h: "Date d'achat", w: 12, v: (x) => x.s.buy_date }, { h: 'Notes', w: 20, v: (x) => x.s.notes },
  ];
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, SC, sealed, { totalsRow: { Produit: 'label', Quantité: 'sum', Valeur: 'sum', Investi: 'sum', 'Plus-value': 'sum' } }), 'Scellés');

  const EC = [
    { h: 'Libellé', w: 34, v: (e) => e.label }, { h: 'Type', w: 12, v: (e) => e.kind }, { h: 'Date', w: 12, v: (e) => e.d },
    { h: 'Montant', w: 12, z: EUR, v: (e) => n(e.amount) }, { h: 'Notes', w: 24, v: (e) => e.notes },
  ];
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, EC, S.expenses, { totalsRow: { Libellé: 'label', Montant: 'sum' } }), 'Dépenses');

  const VC = [
    { h: 'Date', w: 12, v: (s) => s.d }, { h: 'Article', w: 30, v: (s) => s.name }, { h: 'Numéro', w: 8, v: (s) => s.local_id }, { h: 'Série', w: 22, v: (s) => s.set_name },
    { h: 'Quantité', w: 9, v: (s) => s.qty }, { h: 'Prix unitaire', w: 12, z: EUR, v: (s) => n(s.price) }, { h: 'Frais', w: 10, z: EUR, v: (s) => n(s.fees) ?? 0 },
    { h: 'Encaissé', w: 12, z: EUR, v: (s) => saleCalc(s).net, f: (r) => `E${r}*F${r}-G${r}` },
    { h: "Prix d'achat", w: 12, z: EUR, v: (s) => n(s.cost) ?? 0 },
    { h: 'Plus-value', w: 12, z: EUR, v: (s) => saleCalc(s).pl, f: (r) => `H${r}-I${r}` }, { h: 'Notes', w: 20, v: (s) => s.notes },
  ];
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, VC, S.sales, { totalsRow: { Date: 'label', Quantité: 'sum', Encaissé: 'sum', "Prix d'achat": 'sum', 'Plus-value': 'sum' } }), 'Ventes');

  // Résumé : formules qui pointent vers les feuilles (se recalcule si tu modifies une cote)
  const t = totals();
  const rC = cards.length + 1, rS = sealed.length + 1, rE = S.expenses.length + 1, rV = S.sales.length + 1;
  const sum = (sh, c, last) => (last > 1 ? `SUM('${sh}'!${c}2:${c}${last})` : '0');
  const R = [
    ['Valeur des cartes', sum('Cartes', 'K', rC), t.cardsValue],
    ['Valeur des scellés', sum('Scellés', 'G', rS), t.sealedValue],
    ['Valeur totale', 'B2+B3', t.value],
    ['Investi en cartes', sum('Cartes', 'L', rC), null],
    ['Investi en scellés', sum('Scellés', 'H', rS), null],
    ['Dépenses (ouvertures, lots, frais)', sum('Dépenses', 'D', rE), t.spent],
    ['Investi total', 'B5+B6+B7', t.invested],
    ['Plus-value latente', 'B4-B8', t.latent],
    ['Plus-value réalisée (ventes)', sum('Ventes', 'J', rV), t.realized],
    ['Plus-value totale', 'B9+B10', t.pl],
    ['Rendement', `IF(B8+${sum('Ventes', 'I', rV)}=0,"",B11/(B8+${sum('Ventes', 'I', rV)}))`, t.pct != null ? t.pct / 100 : null],
  ];
  const ws = { A1: { t: 's', v: 'Farde : résumé au ' + new Date().toLocaleDateString('fr-FR') }, B1: { t: 's', v: '' } };
  R.forEach(([lab, f, v], i) => {
    ws['A' + (i + 2)] = { t: 's', v: lab };
    ws['B' + (i + 2)] = { t: 'n', f, ...(v != null ? { v } : {}), z: lab === 'Rendement' ? PCT : EUR };
  });
  ws['A' + (R.length + 3)] = { t: 's', v: `Cote de référence : ${S.settings.basis}. Exporté depuis Farde.` };
  ws['!ref'] = `A1:B${R.length + 3}`;
  ws['!cols'] = [{ wch: 36 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Résumé');
  wb.SheetNames = ['Résumé', 'Cartes', 'Scellés', 'Dépenses', 'Ventes'];

  XLSX.writeFile(wb, `farde-${today()}.xlsx`, { compression: true });
}
