import { S, calcLine, deleteCards, moveCards, moveToExpense } from '../store.js';
import { variantLabel } from '../valuation.js';
import { openCard } from '../carddialog.js';
import { esc, eur, signEur, pct, plClass, cardImg, LANGS, toast, download, toCsv, csvNum, today, confirmButton, $, $$ } from '../ui.js';

const st = { q: '', lang: '', binder: '', type: '', sort: { k: 'value', d: -1 }, sel: new Set(), limit: 200 };
let root;

export function render(el) {
  const qp = new URLSearchParams(location.hash.split('?')[1] || '');
  if (qp.has('type')) st.type = qp.get('type');
  el.innerHTML = `<section class="view">
    <div class="vh"><div><h2>Collection</h2><p>Chaque ligne a son prix d’achat, son état et sa plus-value en direct.</p></div>
      <div class="row"><button class="btn" id="kXlsx">Excel</button><button class="btn" id="kCsv">CSV</button><a class="btn" href="#ajout?mode=scan"><svg class="ic"><use href="#i-scan"/></svg>Scanner</a><a class="btn pri" href="#catalogue">Ajouter des cartes</a></div></div>
    <div class="row panel">
      <div class="field" style="flex:2 1 200px"><label for="kQ">Filtrer</label><input id="kQ" type="search" placeholder="Nom, série, numéro…" value="${esc(st.q)}"></div>
      <div class="field" style="flex:1 1 120px"><label for="kLang">Langue</label><select id="kLang"></select></div>
      <div class="field" style="flex:1 1 140px"><label for="kBind">Farde</label><select id="kBind"></select></div>
      <div class="field" style="flex:1 1 130px"><label for="kType">Type</label><select id="kType"><option value="">Tout</option><option value="raw">Non gradées</option><option value="graded">Gradées</option><option value="noprice">Sans cote</option><option value="nobuy">Sans prix d’achat</option><option value="check">À coter</option></select></div>
    </div>
    <div class="tw"><table class="resp" id="kTable"><thead><tr>
      <th class="c-chk"><input type="checkbox" id="kAll" aria-label="Tout sélectionner"></th><th></th><th data-s="name">Carte</th><th data-s="set">Série</th><th data-s="lang">Lang.</th><th data-s="cond">État</th>
      <th class="r" data-s="qty">Qté</th><th class="r" data-s="buy">Achat u.</th><th class="r" data-s="unit">Cote u.</th><th class="r" data-s="value">Valeur</th><th class="r" data-s="pl">P&amp;L</th>
    </tr></thead><tbody></tbody><tfoot></tfoot></table></div>
    <div class="row" id="kMore" hidden><button class="btn" id="kMoreBtn">Afficher plus</button></div>
    <div class="bulk" id="kBulk" hidden><b id="kSelN"></b><select id="kMoveTo" aria-label="Farde de destination"></select><button class="btn sm" id="kMove">Déplacer</button><select id="kExpTo" aria-label="Dépense"></select><button class="btn sm" id="kExp">Rattacher</button><button class="btn sm" id="kDel">Supprimer</button><button class="btn sm" id="kNone">Annuler</button></div>
  </section>`;
  root = el.firstElementChild;
  $('#kType', root).value = st.type;
  for (const [id, key] of [['kQ', 'q'], ['kLang', 'lang'], ['kBind', 'binder'], ['kType', 'type']]) {
    $('#' + id, root).addEventListener('input', (e) => { st[key] = e.target.value; st.limit = 200; body(); });
  }
  $('#kTable thead', root).addEventListener('click', (e) => {
    const th = e.target.closest('th[data-s]'); if (!th) return;
    const k = th.dataset.s;
    st.sort = st.sort.k === k ? { k, d: -st.sort.d } : { k, d: ['name', 'set', 'lang', 'cond'].includes(k) ? 1 : -1 };
    body();
  });
  $('#kAll', root).onchange = (e) => { const rows = filtered(); if (e.target.checked) rows.forEach((l) => st.sel.add(l.id)); else st.sel.clear(); body(); };
  $('#kTable tbody', root).addEventListener('click', (e) => {
    const cb = e.target.closest('input[data-sel]');
    if (cb) { if (cb.checked) st.sel.add(cb.dataset.sel); else st.sel.delete(cb.dataset.sel); bulkBar(); return; }
    const tr = e.target.closest('tr[data-id]');
    if (tr && !e.target.closest('.c-chk')) { const l = S.cards.find((c) => c.id === tr.dataset.id); if (l) openCard(l.lang, l.card_id, { line: l }); }
  });
  $('#kMoreBtn', root).onclick = () => { st.limit += 500; body(); };
  $('#kExp', root).onclick = async () => {
    try { const ids = [...st.sel], v = $('#kExpTo', root).value || null; await moveToExpense(ids, v); st.sel.clear(); toast(v ? `${ids.length} ligne${ids.length > 1 ? 's' : ''} rattachée${ids.length > 1 ? 's' : ''}.` : 'Rattachement retiré.'); } catch (e) { toast(e.message, 5000); }
  };
  $('#kNone', root).onclick = () => { st.sel.clear(); body(); };
  $('#kMove', root).onclick = async () => {
    try { const ids = [...st.sel]; await moveCards(ids, $('#kMoveTo', root).value || null); st.sel.clear(); toast(`${ids.length} ligne${ids.length > 1 ? 's' : ''} déplacée${ids.length > 1 ? 's' : ''}.`); } catch (e) { toast(e.message, 5000); }
  };
  $('#kDel', root).onclick = async (e) => {
    if (!confirmButton(e.target, `Confirmer (${st.sel.size})`)) return;
    try { const n = st.sel.size; await deleteCards([...st.sel]); st.sel.clear(); toast(`${n} ligne${n > 1 ? 's' : ''} supprimée${n > 1 ? 's' : ''}.`); } catch (err) { toast(err.message, 5000); }
  };
  $('#kCsv', root).onclick = exportCsv;
  $('#kXlsx', root).onclick = async (e) => {
    e.target.disabled = true;
    try { const { exportExcel } = await import('../excel.js'); await exportExcel(); toast('Fichier Excel téléchargé : collection, scellés, dépenses, ventes et résumé.'); }
    catch (err) { toast(err.message, 5000); } finally { e.target.disabled = false; }
  };
  update();
}

function selects() {
  const langs = [...new Set(S.cards.map((l) => l.lang))];
  const kl = $('#kLang', root);
  kl.innerHTML = `<option value="">Toutes</option>` + langs.map((l) => `<option value="${l}">${LANGS[l] || l}</option>`).join('');
  kl.value = langs.includes(st.lang) ? st.lang : '';
  const bOpts = S.binders.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  const kb = $('#kBind', root);
  kb.innerHTML = `<option value="">Toutes</option>${bOpts}<option value="__none">Sans farde</option>`;
  kb.value = st.binder;
  $('#kMoveTo', root).innerHTML = bOpts + `<option value="">Aucune farde</option>`;
  $('#kExpTo', root).innerHTML = S.expenses.map((e) => `<option value="${e.id}">${esc(e.label)}</option>`).join('') + `<option value="">Aucune dépense</option>`;
  $('#kExpTo', root).hidden = $('#kExp', root).hidden = !S.expenses.length;
}

function filtered() {
  const q = st.q.trim().toLowerCase();
  return S.cards.filter((l) => {
    if (q && ![l.name, l.set_name, l.local_id, l.set_id, l.notes].join(' ').toLowerCase().includes(q)) return false;
    if (st.lang && l.lang !== st.lang) return false;
    if (st.binder && (st.binder === '__none' ? l.binder_id : l.binder_id !== st.binder)) return false;
    if (st.type === 'graded' && !l.grading_company) return false;
    if (st.type === 'raw' && l.grading_company) return false;
    if (st.type === 'noprice' && calcLine(l).value != null) return false;
    if (st.type === 'nobuy' && l.buy_price != null) return false;
    if (st.type === 'check' && !calcLine(l).toCheck) return false;
    return true;
  });
}

function body() {
  if (!root?.isConnected) return;
  const rows = filtered().map((l) => ({ l, c: calcLine(l) }));
  const key = { name: (x) => x.l.name, set: (x) => x.l.set_name || '', lang: (x) => x.l.lang, cond: (x) => x.l.condition, qty: (x) => x.l.qty,
    buy: (x) => x.l.buy_price ?? -1, unit: (x) => x.c.unit ?? -1, value: (x) => x.c.value ?? -1, pl: (x) => x.c.pl ?? -1e9 }[st.sort.k];
  rows.sort((a, b) => { const A = key(a), B = key(b); return (typeof A === 'string' ? A.localeCompare(B, 'fr') : A - B) * st.sort.d; });
  const tb = $('#kTable tbody', root);
  if (!S.cards.length) {
    tb.innerHTML = `<tr><td colspan="11"><div class="empty">Ta collection est vide. <a href="#ajout?mode=scan">Scanne tes cartes</a>, cherche-les dans le <a href="#catalogue">Catalogue</a> ou <a href="#import">importe ton tableur</a>.</div></td></tr>`;
    $('#kTable tfoot', root).innerHTML = ''; $('#kMore', root).hidden = true; bulkBar(); return;
  }
  const shown = rows.slice(0, st.limit);
  tb.innerHTML = shown.map(({ l, c }) => {
    const tags = `${l.variant !== 'normal' ? esc(variantLabel(l.variant)) : ''}${c.toCheck ? ' <span class="pill al" title="Cardmarket ne cote pas cette version à part : saisis une cote manuelle">à coter</span>' : ''}${l.grading_company ? ` <span class="pill acc">${esc(l.grading_company)} ${esc(l.grade || '')}</span>` : ''}${l.manual_price != null ? ' <span class="pill">cote manuelle</span>' : ''}`;
    return `<tr data-id="${l.id}" style="cursor:pointer">
    <td class="c-chk"><input type="checkbox" data-sel="${l.id}" ${st.sel.has(l.id) ? 'checked' : ''} aria-label="Sélectionner"></td>
    <td class="c-img">${cardImg(l.image, l.name, 'thumb')}</td>
    <td class="c-main"><b>${esc(l.name)}</b> <span class="muted num small">${esc(l.local_id || '')}</span>${tags ? `<div class="sub">${tags}</div>` : ''}</td>
    <td class="c-meta-sm c-meta sub">${esc(l.set_name || '')} · ${esc(l.lang.toUpperCase())} · ${l.grading_company ? '' : esc(l.condition) + ' · '}×${l.qty}${l.buy_price != null ? ' · achat ' + eur(l.buy_price) : ''}</td>
    <td class="hide-sm">${esc(l.set_name || '—')}</td><td class="hide-sm">${esc(l.lang.toUpperCase())}</td><td class="hide-sm">${l.grading_company ? '—' : esc(l.condition)}</td>
    <td class="r num hide-sm">${l.qty}</td><td class="r num hide-sm">${eur(l.buy_price)}</td><td class="r num hide-sm">${eur(c.unit)}</td>
    <td class="r num c-val"><b>${eur(c.value)}</b></td>
    <td class="r num c-pl ${plClass(c.pl)}">${c.pl != null ? signEur(c.pl) + `<div class="small">${c.invested ? pct((c.pl / c.invested) * 100) : ''}</div>` : '—'}</td></tr>`;
  }).join('') || `<tr><td colspan="11"><div class="empty">Aucune carte ne correspond au filtre.</div></td></tr>`;
  const sv = rows.reduce((a, x) => a + (x.c.value || 0), 0), si = rows.reduce((a, x) => a + x.c.invested, 0), sq = rows.reduce((a, x) => a + x.l.qty, 0);
  $('#kTable tfoot', root).innerHTML = `<tr><td class="hide-sm"></td><td class="hide-sm"></td><td>${rows.length.toLocaleString('fr-FR')} ligne${rows.length > 1 ? 's' : ''} · ${sq.toLocaleString('fr-FR')} cartes</td><td class="hide-sm"></td><td class="hide-sm"></td><td class="hide-sm"></td><td class="hide-sm"></td>
    <td class="r num hide-sm">${eur(si)}</td><td class="hide-sm"></td><td class="r num">${eur(sv)}</td><td class="r num ${plClass(sv - si)}">${signEur(sv - si)}</td></tr>`;
  $$('#kTable th[data-s]', root).forEach((th) => { th.textContent = th.textContent.replace(/ [↑↓]$/, '') + (th.dataset.s === st.sort.k ? (st.sort.d > 0 ? ' ↑' : ' ↓') : ''); });
  $('#kMore', root).hidden = rows.length <= st.limit;
  $('#kAll', root).checked = rows.length > 0 && rows.every((x) => st.sel.has(x.l.id));
  bulkBar();
}

function bulkBar() {
  for (const id of [...st.sel]) if (!S.cards.some((c) => c.id === id)) st.sel.delete(id);
  $('#kBulk', root).hidden = !st.sel.size;
  $('#kSelN', root).textContent = `${st.sel.size} sélectionnée${st.sel.size > 1 ? 's' : ''}`;
}

function exportCsv() {
  const H = ['Nom', 'Numéro', 'Série', 'Langue', 'Variante', 'État', 'Gradation', 'Quantité', "Prix d'achat unitaire", "Date d'achat", 'Cote unitaire', 'Valeur', 'Plus-value', 'Farde', 'Notes', 'ID TCGdex'];
  const rows = filtered().map((l) => {
    const c = calcLine(l);
    return [l.name, l.local_id, l.set_name, l.lang, variantLabel(l.variant), l.condition, l.grading_company ? `${l.grading_company} ${l.grade || ''}` : '',
      l.qty, csvNum(l.buy_price), l.buy_date, csvNum(c.unit), csvNum(c.value), csvNum(c.pl), S.binders.find((b) => b.id === l.binder_id)?.name || '', l.notes, l.card_id];
  });
  download(`farde-collection-${today()}.csv`, toCsv(H, rows), 'text/csv;charset=utf-8');
  toast('CSV exporté. Il se réimporte tel quel dans Collection › Importer.');
}

export function update() { if (!root?.isConnected) return; selects(); body(); }
