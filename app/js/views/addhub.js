// Ajouter des items : une seule page qui explique les 3 façons d'ajouter des cartes et les 2 façons d'ajouter des scellés.
import { cardTemplate } from './import.js';
import { sealedTemplate } from './importsealed.js';
import { $ } from '../ui.js';

const req = (list) => list.map((x) => `<span class="pill acc">${x}</span>`).join(' ');

export function render(el) {
  el.innerHTML = `<section class="view hub">
    <div class="vh"><div><h2>Quels items souhaitez-vous importer ?</h2><p>Pour ajouter beaucoup d’items d’un coup : un tableau (Excel, Google Sheets, CSV) ou le scan. Rien n’est écrasé.</p></div></div>
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
            <b>Scanner</b><span class="muted small">L’appareil photo lit le numéro en bas de la carte et l’ajoute. Idéal après une ouverture de boosters.</span>
            <div class="row"><a class="btn pri sm" href="#ajout?mode=scan"><svg class="ic"><use href="#i-scan"/></svg>Scanner mes cartes</a><a class="btn sm" href="#ajout?mode=set">Ouverture : cliquer les cartes d’une série</a></div>
          </div></li>
        </ol>
        <p class="note hub-alt">Une carte à la fois ? Va dans l’<a href="#ajouter?t=cartes">onglet Ajouter</a> (recherche par série, rareté, promo) et clique sur « + ».</p>
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
        </ol>
        <p class="note hub-alt">Un produit à la fois ? Va dans l’<a href="#ajouter?t=scelles">onglet Ajouter › Scellés</a> : recherche dans le catalogue Cardmarket et « + ». Le scan n’existe pas pour les scellés (pas de numéro lisible sur les boîtes).</p>
      </div>
    </div>
  </section>`;
  const root = el.firstElementChild;
  $('#hTplC', root).onclick = cardTemplate;
  $('#hTplS', root).onclick = sealedTemplate;
}
export function update() {}
