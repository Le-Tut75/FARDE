// Fiche d'une carte : cotes, historique, ajout ou modification d'une ligne de collection.
import { S, addCard, updateCard, deleteCards, addWish, calcLine, priceHistory, ownedQty, cmOf } from './store.js';
import { getCard } from './tcgdex.js';
import { CONDITIONS, VARIANTS, lineCalc, cardKey } from './valuation.js';
import { esc, eur, usd, signEur, plClass, openDialog, closeDialog, toast, num, today, LANGS, cardImg, lineChart, confirmButton, $ } from './ui.js';

const GRADERS = ['PSA', 'CGC', 'BGS', 'PCA', 'Collect Aura', 'SGC', 'Autre'];

/**
 * Ouvre la fiche d'une carte.
 * opts.line : ligne de collection à modifier ; opts.prefill : valeurs proposées (import)
 */
export async function openCard(lang, cardId, opts = {}) {
  openDialog(`<div class="mbody" style="align-items:center;padding:48px"><span class="spin"></span></div>`);
  let c = null;
  try { c = await getCard(lang, cardId); } catch (e) { /* hors ligne : on utilise ce qu'on a */ }
  const line = opts.line || null;
  if (!c && !line) {
    openDialog(`<div class="mbody"><p class="loss">Impossible de charger cette carte. Vérifie ta connexion puis réessaie.</p><div class="row end"><button class="btn" data-close>Fermer</button></div></div>`);
    return;
  }
  c = c || { id: cardId, name: line.name, image: line.image, localId: line.local_id, set: { id: line.set_id, name: line.set_name, total: line.set_total }, variants: null, cm: null };
  const cm = c.cm || cmOf(lang, cardId);
  const tp = c.tcgplayer || S.prices.get(cardKey(lang, cardId))?.tcgplayer;
  const variants = c.variants ? Object.keys(VARIANTS).filter((k) => c.variants[k]) : ['normal'];
  if (!variants.length) variants.push('normal');
  const L = line || {
    variant: variants.includes('holo') && !variants.includes('normal') ? 'holo' : variants[0], condition: 'NM', qty: 1,
    buy_price: null, buy_date: today(), binder_id: S.binders[0]?.id || null, grading_company: null, grade: null, manual_price: null, notes: null,
    ...(opts.prefill || {}),
  };
  if (L.variant && !variants.includes(L.variant)) variants.push(L.variant);
  const own = ownedQty(lang, cardId);
  const inWish = S.wish.find((w) => w.lang === lang && w.card_id === cardId);
  const P = (k, lab) => (cm && cm[k] != null ? `<div><span>${lab}</span><b>${eur(cm[k])}</b></div>` : '');
  let tpBlock = '';
  if (tp) for (const [k, v] of Object.entries(tp)) if (v && typeof v === 'object' && v.marketPrice != null) tpBlock += `<div><span>TCGplayer ${esc(k)}</span><b>${usd(v.marketPrice)}</b></div>`;
  const q = encodeURIComponent(`${c.name} ${c.localId || ''}`.trim());
  const qEbay = encodeURIComponent(`${c.name} ${c.localId || ''}${c.set?.total ? '/' + c.set.total : ''} ${line?.grading_company ? line.grading_company + ' ' + (line.grade || '') : ''}`.trim());

  const d = openDialog(`<div style="position:relative"><button class="btn sm close" data-close aria-label="Fermer">✕</button>
  <div class="md"><div class="cimg">${cardImg(c.image, c.name, '', 'high')}</div>
  <div class="stack" style="min-width:0">
    <div><h3>${esc(c.name)}</h3>
      <div class="muted">${esc(c.set?.name || '')} · ${esc(c.localId || '')}${c.set?.total ? '/' + c.set.total : ''} · ${esc(LANGS[lang] || lang)}${c.rarity ? ' · ' + esc(c.rarity) : ''}</div>
      ${c.illustrator ? `<div class="muted small">Illustration : ${esc(c.illustrator)}</div>` : ''}
      ${own ? `<div style="margin-top:6px"><span class="pill ok">Possédée ×${own}</span></div>` : ''}</div>
    ${cm ? `<div class="prices">${P('trend', 'Tendance')}${P('avg30', 'Moy. 30 j')}${P('avg7', 'Moy. 7 j')}${P('low', 'Plus bas')}${P('trend-holo', 'Tendance reverse')}${P('avg30-holo', 'Moy. 30 j reverse')}${tpBlock}</div>
      <p class="note">Cote Cardmarket ${cm.updated ? 'du ' + new Date(cm.updated).toLocaleDateString('fr-FR') : ''}, toutes langues confondues, pour une carte Near Mint.</p>`
      : `<p class="note">Pas de cote Cardmarket pour cette carte (fréquent pour les cartes japonaises et les toutes nouvelles sorties). Saisis une cote manuelle ci-dessous.</p>`}
    <div class="chart" id="cdChart"><span class="muted small">Historique de la cote…</span></div>
    <div class="row"><a class="btn sm" href="https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${q}" target="_blank" rel="noopener">Cardmarket</a>
      <a class="btn sm" href="https://www.ebay.fr/sch/i.html?_nkw=${qEbay}&LH_Sold=1&LH_Complete=1" target="_blank" rel="noopener">Ventes conclues eBay</a></div>
    <form id="cdForm" class="panel stack" style="background:var(--sunk)">
      <h3>${line ? 'Modifier la ligne' : 'Ajouter à la collection'}</h3>
      <div class="fgrid">
        <div class="field"><label for="fVar">Variante</label><select id="fVar">${variants.map((k) => `<option value="${k}" ${k === L.variant ? 'selected' : ''}>${VARIANTS[k] || k}</option>`).join('')}</select></div>
        <div class="field"><label for="fCond">État</label><select id="fCond">${CONDITIONS.map(([k, n]) => `<option value="${k}" ${k === L.condition ? 'selected' : ''}>${k} · ${n}</option>`).join('')}</select></div>
        <div class="field"><label for="fQty">Quantité</label><input id="fQty" type="number" min="1" max="9999" step="1" value="${L.qty}" required></div>
        <div class="field"><label for="fBuy">Prix d'achat unitaire (€)</label><input id="fBuy" type="number" min="0" step="0.01" inputmode="decimal" value="${L.buy_price ?? ''}" placeholder="0,00"></div>
        <div class="field"><label for="fDate">Date d'achat</label><input id="fDate" type="date" value="${esc(L.buy_date || '')}"></div>
        <div class="field"><label for="fBind">Farde</label><select id="fBind">${S.binders.map((b) => `<option value="${b.id}" ${b.id === L.binder_id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}<option value="" ${!L.binder_id ? 'selected' : ''}>Aucune</option></select></div>
        <div class="field"><label for="fGc">Gradation</label><select id="fGc"><option value="">Aucune (raw)</option>${GRADERS.map((g) => `<option ${L.grading_company === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
        <div class="field"><label for="fGg">Note</label><input id="fGg" type="text" value="${esc(L.grade || '')}" placeholder="10"></div>
        <div class="field"><label for="fMan">Cote manuelle u. (€)</label><input id="fMan" type="number" min="0" step="0.01" inputmode="decimal" value="${L.manual_price ?? ''}" placeholder="automatique"></div>
      </div>
      <div class="field"><label for="fNotes">Notes</label><input id="fNotes" type="text" value="${esc(L.notes || '')}" placeholder="Acheté en convention, échange avec…"></div>
      <div class="row between"><span class="note" id="fPrev"></span>
        <div class="row">${line ? `<button type="button" class="btn dng" id="fDel">Supprimer</button>` : `<button type="button" class="btn" id="fWish">${inWish ? 'Dans la wishlist' : 'Ajouter à la wishlist'}</button>`}
        <button class="btn pri" type="submit" id="fSave">${line ? 'Enregistrer' : 'Ajouter'}</button></div></div>
    </form>
  </div></div></div>`);

  const read = () => ({
    variant: $('#fVar', d).value, condition: $('#fCond', d).value,
    qty: Math.min(9999, Math.max(1, parseInt($('#fQty', d).value, 10) || 1)),
    buy_price: num($('#fBuy', d).value), buy_date: $('#fDate', d).value || null, binder_id: $('#fBind', d).value || null,
    grading_company: $('#fGc', d).value || null, grade: $('#fGc', d).value ? ($('#fGg', d).value.trim() || null) : null,
    manual_price: num($('#fMan', d).value), notes: $('#fNotes', d).value.trim() || null,
  });
  const prev = () => {
    const r = lineCalc({ ...read(), lang, card_id: cardId }, cm, S.settings);
    $('#fPrev', d).innerHTML = r.value != null
      ? `Valeur ${eur(r.value)}${r.pl != null ? ` · P&amp;L <b class="${plClass(r.pl)}">${signEur(r.pl)}</b>` : ''}${r.source === 'brut' ? ' · cote non gradée, saisis la cote de la gradée' : ''}`
      : 'Pas de cote : saisis une cote manuelle.';
  };
  $('#cdForm', d).addEventListener('input', prev); prev();

  $('#cdForm', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#fSave', d); btn.disabled = true;
    try {
      const data = read();
      if (line) { await updateCard(line.id, data); toast('Ligne mise à jour.'); }
      else {
        await addCard({ lang, card_id: cardId, name: c.name, local_id: c.localId, set_id: c.set?.id || null, set_name: c.set?.name || null,
          set_total: c.set?.total ?? null, image: c.image || null, rarity: c.rarity || null, source: 'manuel', ...data });
        toast('Ajoutée à ta collection.');
      }
      closeDialog();
    } catch (err) { toast(err.message, 5000); btn.disabled = false; }
  });
  const del = $('#fDel', d);
  if (del) del.onclick = async () => {
    if (!confirmButton(del, 'Confirmer la suppression')) return;
    try { await deleteCards([line.id]); closeDialog(); toast('Ligne supprimée.'); } catch (err) { toast(err.message, 5000); }
  };
  const wb = $('#fWish', d);
  if (wb) wb.onclick = async () => {
    if (inWish) { closeDialog(); location.hash = '#wishlist'; return; }
    try {
      await addWish({ lang, card_id: cardId, name: c.name, local_id: c.localId, set_name: c.set?.name || null, image: c.image || null, variant: $('#fVar', d).value });
      wb.textContent = 'Dans la wishlist'; toast('Ajoutée à la wishlist. Fixe ton prix cible dans l’onglet Wishlist.');
    } catch (err) { toast(err.message, 5000); }
  };

  // Historique (tâche quotidienne)
  try {
    const h = await priceHistory(`card:${lang}:${cardId}`);
    const el = $('#cdChart', d); if (!el) return;
    const foil = (line?.variant || L.variant) === 'reverse';
    const rows = h.map((r) => ({ d: r.d, v: foil ? (r.trend_holo ?? r.trend) : (r.trend ?? r.trend_holo) }));
    const svg = lineChart(rows, [{ key: 'v', color: 'var(--accent)', area: true }], { height: 160, label: 'Historique de la cote' });
    el.innerHTML = svg ? `<div class="lbl">Cote tendance depuis le début du suivi</div>${svg}` : `<p class="note">L’historique se construit chaque matin à partir du moment où la carte est dans ta collection ou ta wishlist.</p>`;
  } catch { const el = $('#cdChart', d); if (el) el.innerHTML = ''; }
}
