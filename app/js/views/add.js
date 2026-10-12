// Onglet « Ajouter » : cartes et scellés sur une seule page, ajout direct avec « + ».
import * as catalogue from './catalogue.js';
import * as sealed from './sealed.js';
import { $ } from '../ui.js';

let root, tab = null, inner = null;
const KEY = 'farde.addTab';
const remember = (t) => { try { localStorage.setItem(KEY, t); } catch { /* stockage indisponible */ } };
const recall = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

export function render(el) {
  const name = location.hash.slice(1).split('?')[0];
  const qp = new URLSearchParams(location.hash.split('?')[1] || '');
  tab = name === 'ajouter-scelle' || qp.get('t') === 'scelles' ? 'scelles'
    : name === 'ajouter-carte' || name === 'catalogue' || qp.get('t') === 'cartes' ? 'cartes'
    : recall() === 'scelles' ? 'scelles' : 'cartes';
  el.innerHTML = `<section class="view addv">
    <div class="vh"><div><h2>Ajouter</h2><p>Cherche, puis clique sur « + » : l’item est ajouté à ta collection. Un clic sur l’image ouvre la fiche (prix payé, état, version, quantité).</p></div>
      <div class="row"><a class="btn" href="#importer"><svg class="ic"><use href="#i-upload"/></svg>Importer un tableau</a><a class="btn" href="#ajout?mode=scan"><svg class="ic"><use href="#i-scan"/></svg>Scanner</a></div></div>
    <div class="seg addseg" role="tablist" aria-label="Type d’item">
      <button type="button" role="tab" data-t="cartes" aria-selected="${tab === 'cartes'}"><svg class="ic"><use href="#i-cards"/></svg>Cartes</button>
      <button type="button" role="tab" data-t="scelles" aria-selected="${tab === 'scelles'}"><svg class="ic"><use href="#i-box"/></svg>Scellés</button>
    </div>
    <div id="addInner"></div>
  </section>`;
  root = el.firstElementChild;
  $('.addseg', root).onclick = (e) => { const b = e.target.closest('[data-t]'); if (b && b.dataset.t !== tab) show(b.dataset.t, true); };
  show(tab, false);
}

function show(t, user) {
  tab = t; remember(t);
  root.querySelectorAll('.addseg [data-t]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.t === t)));
  if (user) history.replaceState(null, '', `#ajouter?t=${t}`);
  inner?.leave?.();
  inner = t === 'scelles' ? sealed : catalogue;
  const box = $('#addInner', root);
  inner.render(box, { embedded: true });
  // Le champ de recherche prêt à taper (sauf sur téléphone, pour ne pas ouvrir le clavier d'office)
  if (matchMedia('(pointer:fine)').matches) setTimeout(() => (t === 'scelles' ? $('#sQ', box) : $('#cQ', box))?.focus({ preventScroll: true }), 60);
}

export function update() { inner?.update?.(); }
export function leave() { inner?.leave?.(); }
