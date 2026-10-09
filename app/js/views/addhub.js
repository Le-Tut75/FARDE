// Ajouter des items : une seule page qui explique les 3 façons d'ajouter des cartes et les 2 façons d'ajouter des scellés.
import { cardTemplate } from './import.js';
import { sealedTemplate } from './importsealed.js';
import { $ } from '../ui.js';

const req = (list) => list.map((x) => `<span class="pill acc">${x}</span>`).join(' ');

export function render(el) {
  el.innerHTML = `<section class="view hub">
    <div class="vh"><div><h2>Quels items souhaitez-vous importer ?</h2><p>Choisis le type d’item, puis la méthode. Tu peux combiner les méthodes : rien n’est écrasé.</p></div></div>
    <div class="hub-cols">
      <div class="panel hub-col">
        <div class="hub-h"><span class="hub-ic"><svg><use href="#i-cards"/></svg></span><div><h3>Une ou plusieurs cartes</h3><p class="muted small">Cartes à l’unité (loose) ou gradées</p></div></div>
        <ol class="hub-opts">
          <li><span class="hub-n">1</span><div class="stack" style="gap:8px">
            <b>Depuis un tableau</b><span class="muted small">Excel, Google Sheets ou CSV : idéal pour ajouter beaucoup de cartes d’un coup.</span>
            <div class="req"><span class="lbl">Obligatoire</span> ${req(['Nom de la carte'])} <span class="lbl">+ fortement conseillé</span> ${req(['Numéro (ex. 199/165)'])}</div>
            <div class="req"><span class="lbl">Facultatif</span> <span class="muted small">Série, Langue, État, Quantité, Prix d’achat, Date d’achat, Version (reverse, holo…), Gradation (PSA 10…), Notes</span></div>
            <div class="row"><a class="btn pri sm" href="#import">Importer mon tableau</a><button type="button" class="btn sm" id="hTplC">Télécharger le modèle CSV</button></div>
          </div></li>
          <li><span class="hub-n">2</span><div class="stack" style="gap:8px">
            <b>Manuellement</b><span class="muted small">Cherche la carte puis clique sur « + » pour la marquer comme obtenue. Les promos ont leurs raccourcis.</span>
            <form class="row hub-search" id="hFormC" style="flex-wrap:nowrap"><input type="search" id="hQC" placeholder="Dracaufeu, Pikachu 58/102, promo SVP 85…" aria-label="Chercher une carte"><button class="btn sm">Chercher</button></form>
          </div></li>
          <li><span class="hub-n">3</span><div class="stack" style="gap:8px">
            <b>Scanner</b><span class="muted small">L’appareil photo lit le numéro en bas de la carte et l’ajoute. Idéal après une ouverture de boosters.</span>
            <div class="row"><a class="btn pri sm" href="#ajout?mode=scan"><svg class="ic"><use href="#i-scan"/></svg>Scanner mes cartes</a><a class="btn sm" href="#ajout?mode=set">Ouverture : cliquer les cartes d’une série</a></div>
          </div></li>
        </ol>
      </div>
      <div class="panel hub-col">
        <div class="hub-h"><span class="hub-ic"><svg><use href="#i-box"/></svg></span><div><h3>Un ou plusieurs produits scellés</h3><p class="muted small">Displays, ETB, coffrets, blisters, boosters</p></div></div>
        <ol class="hub-opts">
          <li><span class="hub-n">1</span><div class="stack" style="gap:8px">
            <b>Depuis un tableau</b><span class="muted small">Excel, Google Sheets ou CSV. Les noms français sont reconnus (« Display Flammes Fantasmagoriques »).</span>
            <div class="req"><span class="lbl">Obligatoire</span> ${req(['Nom du produit'])}</div>
            <div class="req"><span class="lbl">Facultatif</span> <span class="muted small">Langue, Quantité, Prix d’achat, Date d’achat, Notes</span></div>
            <div class="row"><a class="btn pri sm" href="#import-scelles">Importer mon tableau</a><button type="button" class="btn sm" id="hTplS">Télécharger le modèle CSV</button></div>
          </div></li>
          <li><span class="hub-n">2</span><div class="stack" style="gap:8px">
            <b>Manuellement</b><span class="muted small">Cherche le produit dans le catalogue Cardmarket (~5 000 produits avec leur cote) puis « + ».</span>
            <form class="row hub-search" id="hFormS" style="flex-wrap:nowrap"><input type="search" id="hQS" placeholder="ETB 151, display Évolutions Prismatiques…" aria-label="Chercher un produit scellé"><button class="btn sm">Chercher</button></form>
          </div></li>
          <li class="off"><span class="hub-n">3</span><div class="stack" style="gap:4px">
            <b>Scanner</b><span class="muted small">Pas disponible pour les scellés : les boîtes n’ont pas de numéro lisible. Utilise la recherche ci-dessus.</span>
          </div></li>
        </ol>
      </div>
    </div>
  </section>`;
  const root = el.firstElementChild;
  $('#hTplC', root).onclick = cardTemplate;
  $('#hTplS', root).onclick = sealedTemplate;
  $('#hFormC', root).onsubmit = (e) => { e.preventDefault(); location.hash = `#ajouter-carte?q=${encodeURIComponent($('#hQC', root).value.trim())}`; };
  $('#hFormS', root).onsubmit = (e) => { e.preventDefault(); location.hash = `#ajouter-scelle?q=${encodeURIComponent($('#hQS', root).value.trim())}`; };
}
export function update() {}
