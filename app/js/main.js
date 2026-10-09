// Démarrage de l'app : connexion, navigation, rafraîchissement.
import { configured, sb, S, loadAll, onChange, totals, snapshotToday, refreshLivePrices } from './store.js';
import { $, $$, eur, signEur, pct, plClass, toast, closeDialog, esc } from './ui.js';
import * as dashboard from './views/dashboard.js';
import * as catalogue from './views/catalogue.js';
import * as collection from './views/collection.js';
import * as importView from './views/import.js';
import * as binders from './views/binders.js';
import * as sets from './views/sets.js';
import * as sealed from './views/sealed.js';
import * as wishlist from './views/wishlist.js';
import * as settings from './views/settings.js';
import * as expenses from './views/expenses.js';
import * as opportunities from './views/opportunities.js';
import * as sales from './views/sales.js';
import * as quickadd from './views/quickadd.js';
import * as addhub from './views/addhub.js';
import * as addcard from './views/addcard.js';
import * as importSealed from './views/importsealed.js';
import * as ebay from './views/ebay.js';
import { openSearch } from './search.js';

const ROUTES = { portefeuille: dashboard, catalogue, collection, import: importView, fardes: binders, series: sets, scelles: sealed, wishlist, reglages: settings, depenses: expenses,
  opportunites: opportunities, ventes: sales, ajout: quickadd, ajouter: addhub, 'ajouter-carte': addcard, 'ajouter-scelle': { render: (el) => sealed.render(el, { addOnly: true }), update: sealed.update }, 'import-scelles': importSealed, ebay };
// Sous-sections : une seule entrée dans le menu, des onglets en haut de la page
const GROUPS = {
  portefeuille: [['portefeuille', 'Résumé'], ['ventes', 'Ventes'], ['depenses', 'Dépenses']],
  collection: [['collection', 'Cartes'], ['scelles', 'Scellés'], ['fardes', 'Fardes'], ['series', 'Complétion']],
  marche: [['catalogue', 'Catalogue'], ['opportunites', 'Opportunités'], ['ebay', 'Veille eBay <sup>bêta</sup>']],
};
const PARENT = {};
for (const [g, items] of Object.entries(GROUPS)) for (const [k] of items) PARENT[k] = g;
// Les écrans d'ajout : un lien de retour vers la page « Ajouter des items »
const ADD = { import: 'Tableur de cartes', 'import-scelles': 'Tableur de scellés', ajout: 'Scan et ajout par série', 'ajouter-carte': 'Ajout manuel d’une carte', 'ajouter-scelle': 'Ajout manuel d’un scellé' };
for (const k of Object.keys(ADD)) PARENT[k] = 'ajouter';
let current = null;

settings.applyTheme();

function show(id) {
  for (const s of ['boot', 'auth', 'app']) $('#' + s).hidden = s !== id;
}

const MORE = ['wishlist', 'reglages'];
const TITLES = { portefeuille: 'Tableau de bord', catalogue: 'Catalogue', collection: 'Collection', import: 'Import', fardes: 'Fardes', series: 'Séries', scelles: 'Scellés', wishlist: 'Wishlist', reglages: 'Réglages', depenses: 'Dépenses',
  opportunites: 'Opportunités', ventes: 'Ventes', ajout: 'Scan', ajouter: 'Ajouter des items', 'ajouter-carte': 'Ajouter une carte', 'ajouter-scelle': 'Ajouter un scellé', 'import-scelles': 'Import de scellés', ebay: 'Veille eBay' };
function route() {
  const name = (location.hash || '#portefeuille').slice(1).split('?')[0];
  const key = ROUTES[name] ? name : 'portefeuille';
  const view = ROUTES[key];
  const top = PARENT[key] || key;
  $$('[data-route]').forEach((a) => {
    const on = a.dataset.route === top || (a.dataset.route === 'plus' && MORE.includes(key));
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const sub = $('#subnav'), g = GROUPS[PARENT[key]];
  sub.hidden = !g && !ADD[key];
  sub.className = ADD[key] ? 'subnav back' : 'subnav';
  sub.innerHTML = ADD[key] ? `<a href="#ajouter">← Ajouter des items</a><span>${ADD[key]}</span>`
    : g ? g.map(([k, lab]) => `<a href="#${k}" ${k === key ? 'aria-current="page"' : ''}>${lab}</a>`).join('') : '';
  closeSheet();
  closeDialog();
  current?.leave?.();
  current = view;
  view.render($('#view'));
  document.title = key === 'portefeuille' ? 'Farde' : `${TITLES[key] || 'Farde'} · Farde`;
  scrollTo(0, 0);
}

// Menu « Plus » (téléphone)
function closeSheet() { $('#moreSheet').hidden = true; $('#moreBtn').setAttribute('aria-expanded', 'false'); }
$('#moreBtn').onclick = () => { const s = $('#moreSheet'); s.hidden = !s.hidden; $('#moreBtn').setAttribute('aria-expanded', String(!s.hidden)); };
$('#moreSheet').onclick = (e) => { if (e.target.id === 'moreSheet') closeSheet(); };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
  // « / » ou Ctrl+K : recherche globale
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
  if (!$('#app').hidden && ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)))) { e.preventDefault(); closeSheet(); openSearch(); }
});
document.addEventListener('click', (e) => { if (e.target.closest('[data-gsearch]')) { closeSheet(); openSearch(); } });

function header() {
  const t = totals();
  const pl = t.invested ? `<span class="${plClass(t.pl)}">${signEur(t.pl)} (${pct(t.pct)})</span>` : '';
  $('#hdrValue').textContent = eur(t.value); $('#hdrPL').innerHTML = pl;
  $('#hdrValueM').textContent = eur(t.value); $('#hdrPLM').innerHTML = pl;
  const off = $('#offline');
  off.hidden = !S.offline;
  if (S.offline) off.textContent = `Hors ligne : affichage des données du ${new Date(S.loadedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}, en lecture seule.`;
}

let snapTimer;
onChange(() => {
  if ($('#app').hidden) return;
  header();
  current?.update?.();
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => snapshotToday().catch(() => {}), 4000);
});

async function start(session) {
  S.user = session.user;
  show('boot');
  try { await loadAll(); }
  catch (e) {
    show('auth');
    $('#authErr').textContent = e.message;
    return;
  }
  show('app');
  header();
  route();
}

// ---- Connexion ----
let signup = false;
function authUi() {
  $('#authSubmit').textContent = signup ? 'Créer mon compte' : 'Se connecter';
  $('#authToggle').textContent = signup ? 'J’ai déjà un compte' : 'Créer un compte';
  $('#authPass').autocomplete = signup ? 'new-password' : 'current-password';
}
$('#authToggle').onclick = () => { signup = !signup; $('#authErr').textContent = ''; authUi(); };
$('#authForm').onsubmit = async (e) => {
  e.preventDefault();
  const email = $('#authEmail').value.trim(), password = $('#authPass').value, btn = $('#authSubmit');
  $('#authErr').textContent = ''; btn.disabled = true;
  try {
    const r = signup ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })
      : await sb.auth.signInWithPassword({ email, password });
    if (r.error) throw r.error;
    if (signup && !r.data.session) { $('#authErr').innerHTML = '<span class="gain">Compte créé. Clique sur le lien reçu par e-mail pour l’activer, puis connecte-toi.</span>'; signup = false; authUi(); return; }
    await start(r.data.session);
  } catch (err) {
    const m = err.message || '';
    $('#authErr').textContent = /Invalid login/i.test(m) ? 'E-mail ou mot de passe incorrect.'
      : /not confirmed/i.test(m) ? 'Adresse pas encore confirmée : clique sur le lien reçu par e-mail.'
      : /already registered/i.test(m) ? 'Un compte existe déjà avec cet e-mail : connecte-toi.'
      : /Signups not allowed/i.test(m) ? 'La création de comptes est désactivée sur cette instance.'
      : /fetch|network/i.test(m) ? 'Connexion impossible : vérifie ta connexion internet.' : m;
  } finally { btn.disabled = false; }
};

// ---- Démarrage ----
async function boot() {
  if (!configured) {
    show('auth');
    $('#authForm').innerHTML = `<div class="brand-lg"><span class="logo" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span><h1>Farde</h1></div>
      <p class="loss">L’app n’est pas encore reliée à ta base de données.</p>
      <p class="note">Ajoute les variables <b>SUPABASE_URL</b> et <b>SUPABASE_ANON_KEY</b> dans GitHub (Settings › Secrets and variables › Actions › onglet Variables), puis relance la publication du site (Actions › Publier le site › Run workflow). Le guide d’installation détaille chaque étape.</p>`;
    return;
  }
  window.addEventListener('hashchange', () => { if (!$('#app').hidden) route(); });
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { S.user = null; show('auth'); } });
  const { data } = await sb.auth.getSession();
  if (data.session) await start(data.session); else { show('auth'); authUi(); }

  // Données fraîches quand on revient sur l'app (autre appareil, tâche du matin)
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !S.user || Date.now() - S.loadedAt < 60_000) return;
    try { await loadAll(); } catch { /* on garde l'affichage actuel */ }
  });
  window.addEventListener('online', () => { if (S.user && S.offline) loadAll().then(() => toast('De nouveau en ligne.')).catch(() => {}); });
}
boot().catch((e) => { show('auth'); $('#authErr').textContent = e.message; });

// Application installable et consultable hors ligne
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
