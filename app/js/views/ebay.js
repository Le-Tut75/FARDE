// Veille eBay (bêta) : recherches enregistrées, vérifiées toutes les heures par GitHub Actions, alertes Telegram.
import { S, sb, saveSettings } from '../store.js';
import { landed, scoreItem, DEFAULT_PREFS, countryOf, isAuction } from '../ebayscore.js';
import { esc, eur, openDialog, closeDialog, toast, num, confirmButton, $ } from '../ui.js';

const MARKETS = { EBAY_FR: 'France', EBAY_DE: 'Allemagne', EBAY_IT: 'Italie', EBAY_ES: 'Espagne', EBAY_GB: 'Royaume-Uni', EBAY_US: 'États-Unis' };
const PRESETS = {
  ed1: { label: 'Cartes 1re édition gradées', q: 'pokemon (1st edition, 1ere edition, édition 1, ed1, 1. auflage) (psa, pca, cgc, bgs, collect aura)', graded_only: true, first_ed: true, markets: ['EBAY_FR', 'EBAY_DE', 'EBAY_GB', 'EBAY_IT', 'EBAY_ES'], buying: 'all', exclude: 'lot, proxy' },
  dracau: { label: 'Dracaufeu 1re édition gradé', q: '(dracaufeu, charizard, glurak) (1st edition, 1ere edition, édition 1, 1. auflage) (psa, pca, cgc, bgs)', graded_only: true, first_ed: true, markets: ['EBAY_FR', 'EBAY_DE', 'EBAY_GB'], buying: 'all', exclude: '' },
};
const st = { searches: [], items: [], sid: '', type: '', sort: 'score', safe: false, loaded: false, scores: new Map() };
const prefs = () => ({ ...DEFAULT_PREFS, ...(S.settings.ebay_prefs || {}) });
const COUNTRY = { FR: 'France', DE: 'Allemagne', IT: 'Italie', ES: 'Espagne', BE: 'Belgique', NL: 'Pays-Bas', GB: 'Royaume-Uni', US: 'États-Unis', JP: 'Japon', CA: 'Canada', CH: 'Suisse', AT: 'Autriche', PT: 'Portugal', HK: 'Hong Kong', AU: 'Australie' };
let root;

export function render(el) {
  el.innerHTML = `<section class="view">
    <div class="vh"><div><h2>Veille eBay <span class="pill acc">bêta</span></h2><p>Tes recherches sont vérifiées toutes les heures sur eBay. Les nouvelles annonces arrivent ici et sur Telegram : tu peux enchérir ou acheter avant tout le monde.</p></div>
      <button class="btn pri" id="ebNew"><svg class="ic"><use href="#i-plus"/></svg>Nouvelle recherche</button></div>
    <div id="ebSetup"></div>
    <div class="stack" id="ebSearches"></div>
    <div class="panel stack" id="ebFeedP">
      <div class="row between"><h3>Annonces trouvées</h3>
        <div class="row"><select id="ebSid" style="width:auto"></select>
          <select id="ebType" style="width:auto"><option value="">Enchères et achat immédiat</option><option value="AUCTION">Enchères</option><option value="FIXED_PRICE">Achat immédiat</option></select>
          <select id="ebSort" style="width:auto"><option value="score">Meilleur score</option><option value="landed">Prix rendu croissant</option><option value="new">Plus récentes</option><option value="end">Fin la plus proche</option></select></div></div>
      <div class="row between"><label class="row small" style="gap:6px"><input type="checkbox" id="ebSafe"> Masquer les annonces à risque (score rouge)</label>
        <button type="button" class="btn sm ghost" id="ebPrefs">Hypothèses du prix rendu</button></div>
      <div class="ebgrid" id="ebFeed"><span class="spin"></span></div>
    </div>
  </section>`;
  root = el.firstElementChild;
  $('#ebNew', root).onclick = () => edit(null);
  $('#ebSid', root).onchange = (e) => { st.sid = e.target.value; feed(); };
  $('#ebType', root).onchange = (e) => { st.type = e.target.value; feed(); };
  $('#ebSort', root).onchange = (e) => { st.sort = e.target.value; feed(); };
  $('#ebSafe', root).onchange = (e) => { st.safe = e.target.checked; feed(); };
  $('#ebPrefs', root).onclick = prefsDialog;
  $('#ebSearches', root).addEventListener('click', onSearchClick);
  $('#ebSetup', root).addEventListener('click', (e) => { const p = e.target.closest('[data-preset]'); if (p) edit(null, PRESETS[p.dataset.preset]); });
  $('#ebFeed', root).addEventListener('click', async (e) => {
    const h = e.target.closest('[data-hide]');
    if (!h) { const a = e.target.closest('.ebi[data-k]'); if (a) { e.preventDefault(); detail(a.dataset.k); } return; }
    e.preventDefault();
    const [sid, iid] = h.dataset.hide.split('|');
    const { error } = await sb.from('ebay_items').update({ hidden: true }).eq('search_id', sid).eq('item_id', iid);
    if (error) return toast(error.message, 5000);
    st.items = st.items.filter((x) => !(x.search_id === sid && x.item_id === iid)); feed();
  });
  load();
}
export function update() {}

async function load() {
  const [a, b] = await Promise.all([
    sb.from('ebay_searches').select('*').order('created_at'),
    sb.from('ebay_items').select('*').eq('hidden', false).order('first_seen_at', { ascending: false }).limit(300),
  ]);
  if (!root?.isConnected) return;
  if (a.error) { $('#ebSetup', root).innerHTML = `<div class="panel"><p class="warn">${/ebay_searches/.test(a.error.message) ? 'Mets d’abord à jour la base : relance le fichier schema.sql de la version 1.5 dans Supabase.' : esc(a.error.message)}</p></div>`; $('#ebFeedP', root).hidden = true; return; }
  st.searches = a.data || []; st.items = b.data || []; st.loaded = true;
  draw();
}

const ago = (d) => { if (!d) return null; const m = Math.round((Date.now() - new Date(d)) / 6e4); return m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`; };

function draw() {
  const ran = st.searches.some((s) => s.last_run_at);
  $('#ebSetup', root).innerHTML = !st.searches.length ? `<div class="panel stack">
      <h3>Commence par une recherche toute prête</h3>
      <div class="presets">
        <button class="wbtn" data-preset="ed1"><b>Cartes 1re édition gradées</b><span>PSA, PCA, CGC, BGS · France, Allemagne, Royaume-Uni, Italie, Espagne</span></button>
        <button class="wbtn" data-preset="dracau"><b>Dracaufeu 1re édition gradé</b><span>Exemple de recherche ciblée sur une carte</span></button>
      </div>
      <p class="note">Ou crée ta propre recherche avec « Nouvelle recherche ».</p></div>`
    : !ran ? `<div class="panel stack setup"><h3>Dernière étape : activer la veille (10 minutes, une seule fois)</h3>
      <ol class="note" style="margin:0;padding-left:18px;display:grid;gap:4px">
        <li>Crée un compte gratuit sur <a href="https://developer.ebay.com/signin" target="_blank" rel="noopener">developer.ebay.com</a>, puis <b>Application Keys</b> › <b>Production</b> › <b>Create a keyset</b>.</li>
        <li>eBay demande une adresse de notification de suppression de compte : choisis l’exemption « I do not persist eBay data » (Farde ne stocke aucune donnée de compte eBay).</li>
        <li>Copie l’<b>App ID (Client ID)</b> et le <b>Cert ID (Client Secret)</b>.</li>
        <li>GitHub › Settings › Secrets and variables › Actions › New repository secret : <code>EBAY_CLIENT_ID</code> puis <code>EBAY_CLIENT_SECRET</code>.</li>
        <li>GitHub › Actions › <b>Veille eBay</b> › Run workflow. Ensuite, elle tourne seule toutes les heures.</li>
      </ol>
      <p class="note">Le premier passage enregistre les annonces déjà en ligne sans t’alerter ; les alertes concernent ensuite uniquement les nouvelles annonces.</p></div>` : '';
  $('#ebSearches', root).innerHTML = st.searches.map((s) => {
    const n = st.items.filter((i) => i.search_id === s.id).length;
    return `<div class="panel ebs ${s.active ? '' : 'muted'}" data-s="${s.id}">
      <div style="min-width:0"><div class="row" style="gap:8px"><b>${esc(s.label)}</b>${s.active ? '' : '<span class="pill">en pause</span>'}${s.alert ? '<span class="pill acc">Telegram</span>' : ''}</div>
        <div class="muted small ellip">${esc(s.q)}</div>
        <div class="small muted">${(s.markets || []).map((m) => MARKETS[m] || m).join(', ')}${s.graded_only ? ' · gradées' : ''}${s.first_ed ? ' · 1re édition' : ''}${s.max_price ? ' · max ' + eur(s.max_price) : ''}${s.buying === 'auction' ? ' · enchères' : s.buying === 'fixed' ? ' · achat immédiat' : ''}</div>
        <div class="small ${s.last_error ? 'warn' : 'muted'}">${s.last_error ? esc(s.last_error) : s.last_run_at ? `Vérifiée ${ago(s.last_run_at)} · ${n} annonce${n > 1 ? 's' : ''}` : 'Pas encore vérifiée'}</div></div>
      <div class="row" style="flex-wrap:nowrap"><a class="btn sm" href="https://www.ebay.fr/sch/i.html?_nkw=${encodeURIComponent(s.q)}&_sop=10" target="_blank" rel="noopener">Voir sur eBay</a><button class="btn sm" data-toggle="${s.id}">${s.active ? 'Pause' : 'Reprendre'}</button><button class="btn sm" data-edit="${s.id}">Modifier</button></div>
    </div>`;
  }).join('');
  $('#ebSid', root).innerHTML = `<option value="">Toutes les recherches</option>` + st.searches.map((s) => `<option value="${s.id}" ${s.id === st.sid ? 'selected' : ''}>${esc(s.label)}</option>`).join('');
  $('#ebFeedP', root).hidden = !st.searches.length;
  feed();
}

/** Score de chaque annonce, comparée aux autres annonces de la même recherche. */
function scoreAll() {
  st.scores = new Map();
  const bySearch = new Map();
  for (const i of st.items) { if (!bySearch.has(i.search_id)) bySearch.set(i.search_id, []); bySearch.get(i.search_id).push(i); }
  for (const i of st.items) st.scores.set(`${i.search_id}|${i.item_id}`, scoreItem(i, bySearch.get(i.search_id), prefs()));
}
const money = (v, c) => (v == null ? '—' : c === 'EUR' || !c ? eur(v) : `${Number(v).toFixed(2).replace('.', ',')} ${c === 'GBP' ? '£' : c === 'USD' ? '$' : c}`);
const left = (d) => { if (!d) return ''; const h = (new Date(d) - Date.now()) / 36e5; return h <= 0 ? 'terminée' : h < 1 ? `fin dans ${Math.round(h * 60)} min` : h < 48 ? `fin dans ${Math.round(h)} h` : `fin dans ${Math.round(h / 24)} j`; };

function feed() {
  const el = $('#ebFeed', root); if (!el) return;
  scoreAll();
  const sc = (i) => st.scores.get(`${i.search_id}|${i.item_id}`);
  let L = st.items.filter((i) => (!st.sid || i.search_id === st.sid) && (!st.type || (i.buying || []).includes(st.type)) && (!st.safe || sc(i).level !== 'err'));
  if (st.sort === 'end') L = L.filter((i) => i.end_at && new Date(i.end_at) > Date.now()).sort((a, b) => new Date(a.end_at) - new Date(b.end_at));
  else if (st.sort === 'landed') L.sort((a, b) => (sc(a).landed?.total ?? 1e12) - (sc(b).landed?.total ?? 1e12));
  else if (st.sort === 'score') L.sort((a, b) => sc(b).score - sc(a).score);
  el.innerHTML = L.map((i) => {
    const auction = isAuction(i), fresh = Date.now() - new Date(i.first_seen_at) < 864e5, x = sc(i), Ld = x.landed;
    const urgent = auction && i.end_at && new Date(i.end_at) - Date.now() < 6 * 36e5;
    const orig = auction ? (i.bid_price ?? i.price) : i.price;
    return `<a class="ebi" href="${esc(i.url || '#')}" target="_blank" rel="noopener" data-k="${i.search_id}|${esc(i.item_id)}">
      <div class="simg">${i.image ? `<img src="${esc(i.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="ph">eBay</div>'}${fresh ? '<span class="badge ok" style="left:7px;right:auto">Nouveau</span>' : ''}<span class="plus" data-hide="${i.search_id}|${esc(i.item_id)}" title="Masquer cette annonce" role="button">✕</span>
        <span class="score ${x.level}" title="Score de l’annonce">${x.score}</span></div>
      <div class="t1">${esc(i.title)}</div>
      <div class="t2"><span>Rendu France</span><b class="num">${Ld ? eur(Ld.total) + (Ld.shipKnown ? '' : '*') : '—'}</b></div>
      <div class="t2 small"><span>${auction ? `Enchère ${money(orig, i.currency)}${i.bid_count ? ` · ${i.bid_count} offre${i.bid_count > 1 ? 's' : ''}` : ''}` : `${money(orig, i.currency)} achat immédiat`}</span></div>
      <div class="t2 small"><span class="${urgent ? 'warn' : ''}">${auction ? left(i.end_at) : ''}</span><span>${esc(countryOf(i) || '')}${Ld && !Ld.eu ? ' · douane' : ''}</span></div>
    </a>`;
  }).join('') || `<div class="empty" style="grid-column:1/-1">${st.searches.some((s) => s.last_run_at) ? 'Aucune annonce pour l’instant. Les nouvelles annonces apparaîtront ici à chaque passage (toutes les heures).' : 'Les annonces apparaîtront après le premier passage de la veille.'}</div>`;
  if (L.some((i) => sc(i).landed && !sc(i).landed.shipKnown)) el.insertAdjacentHTML('beforeend', '<p class="note" style="grid-column:1/-1">* frais de port non indiqués par le vendeur : prix rendu hors port.</p>');
}

/** Fiche d'une annonce : détail du prix rendu et du score. */
function detail(k) {
  const i = st.items.find((x) => `${x.search_id}|${x.item_id}` === k); if (!i) return;
  const x = st.scores.get(k), L = x.landed, p = prefs(), auction = isAuction(i);
  const row = (lab, v, sub = '') => `<tr><td>${lab}${sub ? `<div class="sub">${sub}</div>` : ''}</td><td class="r num">${v}</td></tr>`;
  openDialog(`<div class="mhead"><h3>Annonce eBay</h3><button class="btn sm" data-close aria-label="Fermer">✕</button></div>
    <div class="mbody">
      <div class="row" style="align-items:flex-start;flex-wrap:nowrap;gap:16px">
        <div style="width:130px;flex:none"><div class="simg">${i.image ? `<img src="${esc(i.image)}" alt="" referrerpolicy="no-referrer">` : '<div class="ph">eBay</div>'}</div></div>
        <div class="stack" style="gap:6px;min-width:0"><b>${esc(i.title)}</b>
          <span class="muted small">${esc(COUNTRY[countryOf(i)] || countryOf(i) || '')} · vendeur ${esc(i.seller || '?')}${i.seller_score ? ` (${esc(i.seller_score)} %${i.feedback_count != null ? `, ${i.feedback_count} évaluations` : ''})` : ''}</span>
          <span class="muted small">${auction ? `Enchère · ${i.bid_count || 0} offre${i.bid_count > 1 ? 's' : ''} · ${left(i.end_at)}` : 'Achat immédiat'}${i.updated_at ? ` · mis à jour ${new Date(i.updated_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</span>
          <div class="row" style="gap:8px;margin-top:4px"><span class="score lg ${x.level}">${x.score}</span><b>${x.level === 'ok' ? 'À regarder en priorité' : x.level === 'al' ? 'Correcte, à vérifier' : 'Prudence'}</b></div></div>
      </div>
      <div class="grid2">
        <div class="panel" style="padding:14px"><h3 style="margin-bottom:6px">Prix rendu en France</h3>
          ${L ? `<table class="mini"><tbody>
            ${row(auction ? 'Enchère actuelle' : 'Prix', eur(L.base), i.currency && i.currency !== 'EUR' ? `${money(auction ? i.bid_price ?? i.price : i.price, i.currency)} converti au taux du jour` : '')}
            ${row('Port vers la France', L.shipKnown ? eur(L.ship) : 'non indiqué')}
            ${L.mode === 'douane' ? row(`Droits de douane (${String(p.duty).replace('.', ',')} %)`, eur(L.duty)) + row(`TVA à l’import (${p.vat} %)`, eur(L.vat)) + row('Frais de dédouanement du transporteur', eur(L.handling)) : ''}
            ${L.mode === 'ioss' ? row(`TVA (${p.vat} %), payée sur eBay à l’achat`, eur(L.vat), `colis de moins de ${p.lowValue} € : pas de droits ni de frais de dédouanement`) : ''}
            ${L.mode === 'ue' ? row('Douane et TVA à l’import', '0,00 €', 'vendeur dans l’Union européenne') : ''}
            <tr class="tot"><td>Total rendu</td><td class="r num">${eur(L.total)}</td></tr></tbody></table>
            ${x.ref ? `<p class="note" style="margin-top:8px">Médiane des annonces comparables : ${eur(x.ref)} rendu France.</p>` : ''}` : '<p class="note">Prix indisponible.</p>'}
        </div>
        <div class="panel" style="padding:14px"><h3 style="margin-bottom:6px">Pourquoi ce score</h3>
          <ul class="reasons">${x.reasons.map((r) => `<li><span class="${r.d > 0 ? 'gain' : r.d < 0 ? 'loss' : 'muted'} num">${r.d > 0 ? '+' : ''}${r.d || '·'}</span>${esc(r.t)}</li>`).join('')}</ul>
        </div>
      </div>
      <p class="note">Estimation, pas un devis : les taux de douane dépendent du classement de l’objet et de son origine, et les frais varient selon le transporteur. Vérifie aussi les photos (coins, étiquette, numéro de certificat) avant d’acheter.</p>
      <div class="row end"><button type="button" class="btn" data-close>Fermer</button><a class="btn pri" href="${esc(i.url || '#')}" target="_blank" rel="noopener">Voir l’annonce sur eBay</a></div>
    </div>`);
}

function prefsDialog() {
  const p = prefs();
  const d = openDialog(`<div class="mhead"><h3>Hypothèses du prix rendu</h3><button class="btn sm" data-close aria-label="Fermer">✕</button></div>
    <form class="mbody" id="epf">
      <p class="note">S’appliquent aux annonces expédiées hors de l’Union européenne (Royaume-Uni, États-Unis, Japon…). Depuis un pays de l’UE, aucun frais d’import.</p>
      <div class="fgrid">
        <div class="field"><label for="epV">TVA à l’import (%)</label><input id="epV" type="number" min="0" max="30" step="0.1" value="${p.vat}"></div>
        <div class="field"><label for="epD">Droits de douane (%)</label><input id="epD" type="number" min="0" max="30" step="0.1" value="${p.duty}"></div>
        <div class="field"><label for="epH">Frais de dédouanement (€)</label><input id="epH" type="number" min="0" step="1" value="${p.handling}"></div>
        <div class="field"><label for="epL">Seuil « petit colis » (€)</label><input id="epL" type="number" min="0" step="1" value="${p.lowValue}"></div>
      </div>
      <p class="note">Par défaut : TVA 20 %, droits 2,7 % (taux courant des cartes à jouer, à vérifier selon l’origine), 15 € de frais transporteur. Sous 150 €, eBay encaisse la TVA à l’achat et il n’y a ni droits ni frais.</p>
      <div class="row between"><button type="button" class="btn" id="epReset">Valeurs par défaut</button><div class="row"><button type="button" class="btn" data-close>Annuler</button><button class="btn pri">Enregistrer</button></div></div>
    </form>`);
  $('#epReset', d).onclick = () => { $('#epV', d).value = DEFAULT_PREFS.vat; $('#epD', d).value = DEFAULT_PREFS.duty; $('#epH', d).value = DEFAULT_PREFS.handling; $('#epL', d).value = DEFAULT_PREFS.lowValue; };
  $('#epf', d).onsubmit = async (e) => {
    e.preventDefault();
    const v = (id, def) => { const n = num($(id, d).value); return n == null || n < 0 ? def : n; };
    try {
      await saveSettings({ ebay_prefs: { vat: v('#epV', 20), duty: v('#epD', 2.7), handling: v('#epH', 15), lowValue: v('#epL', 150) } });
      closeDialog(); toast('Hypothèses enregistrées : prix rendus et scores recalculés.'); feed();
    } catch (err) { toast(/ebay_prefs/.test(err.message) ? 'Mets d’abord à jour la base (schema.sql de la version 1.6).' : err.message, 6000); }
  };
}

async function onSearchClick(e) {
  const t = e.target.closest('[data-toggle]'), ed = e.target.closest('[data-edit]');
  if (t) {
    const s = st.searches.find((x) => x.id === t.dataset.toggle);
    const { error } = await sb.from('ebay_searches').update({ active: !s.active }).eq('id', s.id);
    if (error) return toast(error.message, 5000);
    s.active = !s.active; draw();
  }
  if (ed) edit(st.searches.find((x) => x.id === ed.dataset.edit));
}

function edit(s, preset = null) {
  const x = s || { label: '', q: '', markets: ['EBAY_FR'], graded_only: false, first_ed: false, max_price: null, buying: 'all', exclude: '', alert: true, ...(preset || {}) };
  const d = openDialog(`<div class="mhead"><h3>${s ? 'Modifier la recherche' : 'Nouvelle recherche eBay'}</h3><button class="btn sm" data-close aria-label="Fermer">✕</button></div>
    <form class="mbody" id="ebf">
      <div class="field"><label for="ebL">Nom</label><input id="ebL" type="text" maxlength="80" required value="${esc(x.label)}" placeholder="Dracaufeu 1re édition PSA"></div>
      <div class="field"><label for="ebQ">Mots-clés eBay</label><input id="ebQ" type="text" required minlength="2" value="${esc(x.q)}" placeholder="charizard 1st edition psa">
        <span class="sub">Espace = tous les mots. Parenthèses et virgules = l’un ou l’autre : <code>(dracaufeu, charizard) (psa, cgc)</code>.</span></div>
      <div class="field"><label>Sites eBay</label><div class="row">${Object.entries(MARKETS).map(([k, v]) => `<label class="row small" style="gap:6px"><input type="checkbox" name="ebM" value="${k}" ${x.markets.includes(k) ? 'checked' : ''}> ${v}</label>`).join('')}</div></div>
      <div class="fgrid">
        <div class="field"><label for="ebB">Type d’annonce</label><select id="ebB"><option value="all">Enchères et achat immédiat</option><option value="auction">Enchères seulement</option><option value="fixed">Achat immédiat seulement</option></select></div>
        <div class="field"><label for="ebP">Prix maximum</label><input id="ebP" type="number" min="0" step="1" value="${x.max_price ?? ''}" placeholder="aucun"></div>
        <div class="field"><label for="ebX">Mots à exclure</label><input id="ebX" type="text" value="${esc(x.exclude || '')}" placeholder="lot, proxy, jp"></div>
      </div>
      <div class="row"><label class="row small" style="gap:6px"><input type="checkbox" id="ebG" ${x.graded_only ? 'checked' : ''}> Seulement les cartes gradées (PSA, CGC, PCA…)</label>
        <label class="row small" style="gap:6px"><input type="checkbox" id="eb1" ${x.first_ed ? 'checked' : ''}> Seulement la 1re édition</label>
        <label class="row small" style="gap:6px"><input type="checkbox" id="ebA" ${x.alert ? 'checked' : ''}> Alerte Telegram</label></div>
      ${S.settings.telegram_chat_id ? '' : '<p class="note warn">Pour recevoir les alertes, renseigne ton identifiant Telegram dans Réglages.</p>'}
      <div class="row between"><div>${s ? '<button type="button" class="btn dng" id="ebDel">Supprimer</button>' : ''}</div>
        <div class="row"><button type="button" class="btn" data-close>Annuler</button><button class="btn pri">${s ? 'Enregistrer' : 'Créer la recherche'}</button></div></div>
    </form>`);
  $('#ebB', d).value = x.buying || 'all';
  $('#ebf', d).onsubmit = async (e) => {
    e.preventDefault();
    const markets = [...d.querySelectorAll('input[name=ebM]:checked')].map((i) => i.value);
    if (!markets.length) return toast('Coche au moins un site eBay.');
    const row = { label: $('#ebL', d).value.trim(), q: $('#ebQ', d).value.trim(), markets, buying: $('#ebB', d).value, max_price: num($('#ebP', d).value),
      exclude: $('#ebX', d).value.trim() || null, graded_only: $('#ebG', d).checked, first_ed: $('#eb1', d).checked, alert: $('#ebA', d).checked };
    const { error } = s ? await sb.from('ebay_searches').update(row).eq('id', s.id) : await sb.from('ebay_searches').insert(row);
    if (error) return toast(error.message, 6000);
    closeDialog(); toast(s ? 'Recherche enregistrée.' : 'Recherche créée : elle sera vérifiée au prochain passage (toutes les heures).', 5000);
    load();
  };
  const del = $('#ebDel', d);
  if (del) del.onclick = async () => {
    if (!confirmButton(del, 'Confirmer la suppression')) return;
    const { error } = await sb.from('ebay_searches').delete().eq('id', s.id);
    if (error) return toast(error.message, 5000);
    closeDialog(); load();
  };
}
