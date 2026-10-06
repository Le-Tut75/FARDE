import { S, calcLine, addBinder, updateBinder, deleteBinder } from '../store.js';
import { openCard } from '../carddialog.js';
import { esc, eur, cardImg, openDialog, closeDialog, toast, confirmButton, $ } from '../ui.js';

const st = { id: null, spread: 0 };
let root;

export function render(el) {
  el.innerHTML = `<section class="view">
    <div class="vh"><div><h2>Fardes</h2><p>Range tes cartes dans des classeurs virtuels, page par page, triées par série et numéro.</p></div>
      <button class="btn pri" id="bNew">Nouvelle farde</button></div>
    <div class="row panel">
      <div class="field" style="flex:2 1 200px"><label for="bSel">Farde</label><select id="bSel"></select></div>
      <div class="field" style="flex:1 1 110px"><label for="bLay">Format</label><select id="bLay"><option value="3x3">3 × 3</option><option value="4x3">4 × 3</option><option value="4x4">4 × 4</option></select></div>
      <div class="row" style="align-self:flex-end"><button class="btn" id="bPrev" aria-label="Pages précédentes">←</button><span class="num" id="bPage"></span><button class="btn" id="bNext" aria-label="Pages suivantes">→</button>
        <button class="btn sm" id="bRen">Renommer</button><button class="btn dng sm" id="bDel">Supprimer</button></div>
    </div>
    <div class="row muted" id="bInfo"></div>
    <div class="spreads" id="bSpread"></div>
  </section>`;
  root = el.firstElementChild;
  $('#bSel', root).onchange = (e) => { st.id = e.target.value; st.spread = 0; update(); };
  $('#bLay', root).onchange = async (e) => { try { await updateBinder(cur().id, { layout: e.target.value }); st.spread = 0; } catch (x) { toast(x.message, 5000); } };
  $('#bPrev', root).onclick = () => { st.spread--; update(); };
  $('#bNext', root).onclick = () => { st.spread++; update(); };
  $('#bNew', root).onclick = () => nameDialog('Nouvelle farde', '', async (name, layout) => { const b = await addBinder(name, layout); st.id = b.id; st.spread = 0; });
  $('#bRen', root).onclick = () => nameDialog('Renommer la farde', cur().name, async (name, layout) => updateBinder(cur().id, { name, layout }), cur().layout);
  $('#bDel', root).onclick = async (e) => {
    if (S.binders.length <= 1) return toast('Garde au moins une farde.');
    if (!confirmButton(e.target, 'Confirmer')) return;
    try { await deleteBinder(cur().id); st.id = null; toast('Farde supprimée. Ses cartes restent dans ta collection.'); } catch (x) { toast(x.message, 5000); }
  };
  const sp = $('#bSpread', root);
  sp.addEventListener('click', (e) => { const s = e.target.closest('.slot[data-id]'); if (s) { const l = S.cards.find((c) => c.id === s.dataset.id); if (l) openCard(l.lang, l.card_id, { line: l }); } });
  sp.addEventListener('pointermove', (e) => {
    const s = e.target.closest('.slot.holo'); if (!s || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = s.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    s.style.setProperty('--x', x * 100 + '%'); s.style.setProperty('--y', y * 100 + '%');
    const im = s.querySelector('img'); if (im) im.style.transform = `rotateY(${(x - 0.5) * 14}deg) rotateX(${(0.5 - y) * 14}deg) scale(1.03)`;
  });
  sp.addEventListener('pointerout', (e) => { const s = e.target.closest('.slot'); if (s && !s.contains(e.relatedTarget)) { const im = s.querySelector('img'); if (im) im.style.transform = ''; } });
  update();
}

const cur = () => S.binders.find((b) => b.id === st.id) || S.binders[0];

function nameDialog(title, value, save, layout = '3x3') {
  const d = openDialog(`<form class="mbody" id="nbf"><h3>${esc(title)}</h3>
    <div class="field"><label for="nbn">Nom</label><input id="nbn" type="text" required maxlength="80" value="${esc(value)}" placeholder="Méga-Évolution, Gradées, Échanges…"></div>
    <div class="field"><label for="nbl">Format des pages</label><select id="nbl"><option value="3x3">3 × 3</option><option value="4x3">4 × 3</option><option value="4x4">4 × 4</option></select></div>
    <div class="row end"><button type="button" class="btn" data-close>Annuler</button><button class="btn pri">Enregistrer</button></div></form>`);
  $('#nbl', d).value = layout; $('#nbn', d).focus();
  $('#nbf', d).onsubmit = async (e) => { e.preventDefault(); try { await save($('#nbn', d).value.trim() || 'Farde', $('#nbl', d).value); closeDialog(); } catch (x) { toast(x.message, 5000); } };
}

export function update() {
  if (!root?.isConnected) return;
  const b = cur();
  $('#bSel', root).innerHTML = S.binders.map((x) => `<option value="${x.id}" ${x.id === b?.id ? 'selected' : ''}>${esc(x.name)} (${S.cards.filter((c) => c.binder_id === x.id).reduce((a, c) => a + c.qty, 0)})</option>`).join('');
  if (!b) { $('#bSpread', root).innerHTML = `<div class="empty">Crée ta première farde.</div>`; return; }
  st.id = b.id;
  $('#bLay', root).value = b.layout;
  const [cols, rows] = b.layout.split('x').map(Number), per = cols * rows;
  const lines = S.cards.filter((l) => l.binder_id === b.id).sort((x, y) => (x.set_id || '').localeCompare(y.set_id || '') || String(x.local_id).localeCompare(String(y.local_id), 'fr', { numeric: true }));
  const slots = lines.flatMap((l) => Array.from({ length: Math.min(l.qty, 50) }, () => l));
  const pages = Math.max(1, Math.ceil(slots.length / per)), spreads = Math.ceil(pages / 2);
  st.spread = Math.max(0, Math.min(st.spread, spreads - 1));
  const val = lines.reduce((a, l) => a + (calcLine(l).value || 0), 0);
  $('#bInfo', root).innerHTML = `<span>${slots.length} carte${slots.length > 1 ? 's' : ''}</span><span>·</span><span>${pages} page${pages > 1 ? 's' : ''}</span><span>·</span><span class="num">${eur(val)}</span>`;
  const p1 = st.spread * 2 + 1, p2 = Math.min(p1 + 1, pages);
  $('#bPage', root).textContent = `${p1}${p2 > p1 ? '–' + p2 : ''} / ${pages}`;
  $('#bPrev', root).disabled = st.spread <= 0; $('#bNext', root).disabled = st.spread >= spreads - 1;
  $('#bDel', root).disabled = S.binders.length <= 1;
  const page = (p) => {
    const s = slots.slice(p * per, p * per + per);
    return `<div class="binder" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${Array.from({ length: per }, (_, i) => {
      const l = s[i]; if (!l) return `<div class="slot"></div>`;
      const holo = l.variant !== 'normal' || /rare|illustration|ultra|secr|hyper|holo|ex\b/i.test(l.rarity || l.name || '');
      return `<div class="slot ${holo ? 'holo' : ''}" data-id="${l.id}" title="${esc(l.name)} · ${esc(eur(calcLine(l).unit))}">${cardImg(l.image, l.name)}<i class="shine"></i></div>`;
    }).join('')}</div>`;
  };
  $('#bSpread', root).innerHTML = slots.length ? page(st.spread * 2) + (st.spread * 2 + 1 < pages ? page(st.spread * 2 + 1) : '')
    : `<div class="empty" style="grid-column:1/-1">Cette farde est vide. Choisis-la dans le champ « Farde » en ajoutant une carte, ou sélectionne des cartes dans ta Collection et déplace-les ici.</div>`;
}
