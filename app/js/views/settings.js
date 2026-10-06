import { S, sb, saveSettings, deleteEverything, loadAll } from '../store.js';
import { CONDITIONS, BASES } from '../valuation.js';
import { clearCatalogCache } from '../tcgdex.js';
import { esc, langOptions, toast, num, download, today, frDateTime, confirmButton, $, $$ } from '../ui.js';

let root;
export const THEME_KEY = 'farde.theme';
export function applyTheme() {
  let t = ''; try { t = localStorage.getItem(THEME_KEY) || ''; } catch {}
  if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
}
function repoActionsUrl() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const repo = location.pathname.split('/').filter(Boolean)[0];
  return m && repo ? `https://github.com/${m[1]}/${repo}/actions/workflows/prix-quotidiens.yml` : null;
}

export function render(el) {
  const s = S.settings, j = S.lastJob, sum = j?.summary || {}, actions = repoActionsUrl();
  let theme = ''; try { theme = localStorage.getItem(THEME_KEY) || ''; } catch {}
  el.innerHTML = `<section class="view">
    <div class="vh"><div><h2>Réglages</h2><p>Connecté en tant que <b>${esc(S.user?.email || '')}</b>.</p></div><button class="btn" id="gOut">Se déconnecter</button></div>
    <div class="grid2">
      <div class="panel stack"><h3>Valorisation</h3>
        <div class="field"><label for="gBasis">Cote de référence Cardmarket</label><select id="gBasis">${Object.entries(BASES).map(([k, v]) => `<option value="${k}" ${k === s.basis ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label for="gLang">Langue par défaut</label><select id="gLang">${langOptions(s.default_lang)}</select></div>
        <p class="note">Coefficient appliqué à la cote selon l’état (la cote Cardmarket correspond à une carte Near Mint).</p>
        <div class="fgrid">${CONDITIONS.map(([k, n]) => `<div class="field"><label for="cc-${k}">${k} · ${n}</label><input id="cc-${k}" data-cc="${k}" type="number" min="0" max="1.5" step="0.05" value="${s.cond[k]}"></div>`).join('')}</div>
        <div class="row end"><button class="btn pri" id="gSave">Enregistrer</button></div>
      </div>
      <div class="stack">
        <div class="panel stack"><h3>Mise à jour des cotes</h3>
          ${j ? `<div class="status"><span class="pill ${j.ok ? 'ok' : j.ok === false ? 'err' : 'al'}">${j.ok ? 'Réussie' : j.ok === false ? 'En échec' : 'En cours'}</span><span>${frDateTime(j.finished_at || j.started_at)}</span></div>
            <p class="note">${sum.cardsPriced ?? 0} carte${(sum.cardsPriced ?? 0) > 1 ? 's' : ''} cotée${(sum.cardsPriced ?? 0) > 1 ? 's' : ''} sur ${sum.cards ?? 0}, ${sum.sealedCatalog ?? 0} produits scellés au catalogue${sum.alerts ? `, ${sum.alerts} alerte${sum.alerts > 1 ? 's' : ''} envoyée${sum.alerts > 1 ? 's' : ''}` : ''}.</p>
            ${(sum.warnings || []).length ? `<p class="note warn">${sum.warnings.map(esc).join('<br>')}</p>` : ''}`
            : `<p class="note warn">La mise à jour automatique n’a encore jamais tourné. Les cotes viennent pour l’instant directement du catalogue quand tu ouvres l’app.</p>`}
          <p class="note">Elle tourne seule chaque matin vers 6 h. Pour la lancer tout de suite : GitHub › onglet Actions › « Prix quotidiens » › Run workflow.</p>
          ${actions ? `<a class="btn sm" href="${actions}" target="_blank" rel="noopener" style="align-self:flex-start">Ouvrir la page GitHub de la tâche</a>` : ''}
        </div>
        <div class="panel stack"><h3>Alertes Telegram</h3>
          <p class="note">Reçois un message quand une carte de ta wishlist passe sous ton prix cible. Indique ton identifiant Telegram (voir le guide d’installation, étape facultative).</p>
          <div class="row" style="flex-wrap:nowrap"><input type="text" id="gTg" inputmode="numeric" value="${esc(s.telegram_chat_id || '')}" placeholder="Ex. 123456789"><button class="btn" id="gTgSave">Enregistrer</button></div>
        </div>
      </div>
      <div class="panel stack"><h3>Affichage</h3>
        <div class="field"><label for="gTheme">Thème</label><select id="gTheme"><option value="">Comme le système</option><option value="light">Clair</option><option value="dark">Sombre</option></select></div>
        <button class="btn" id="gCache" style="align-self:flex-start">Vider le cache du catalogue</button>
      </div>
      <div class="panel stack"><h3>Mes données</h3>
        <p class="note">Tes données sont dans ta base Supabase, sauvegardée par Supabase. Tu peux aussi garder une copie de tout.</p>
        <div class="row"><button class="btn" id="gExport">Télécharger une sauvegarde complète (.json)</button></div>
        <div class="row"><button class="btn dng" id="gReset">Effacer toute ma collection</button></div>
      </div>
    </div>
  </section>`;
  root = el.firstElementChild;
  $('#gTheme', root).value = theme;
  $('#gTheme', root).onchange = (e) => { try { localStorage.setItem(THEME_KEY, e.target.value); } catch {} applyTheme(); };
  $('#gOut', root).onclick = async () => { await sb.auth.signOut(); location.hash = ''; location.reload(); };
  $('#gSave', root).onclick = async () => {
    const cond = {}; $$('[data-cc]', root).forEach((i) => { const v = num(i.value); cond[i.dataset.cc] = v == null ? 1 : Math.max(0, Math.min(1.5, v)); });
    try { await saveSettings({ basis: $('#gBasis', root).value, default_lang: $('#gLang', root).value, cond }); toast('Réglages enregistrés.'); } catch (x) { toast(x.message, 5000); }
  };
  $('#gTgSave', root).onclick = async () => {
    const v = $('#gTg', root).value.trim();
    if (v && !/^-?\d{4,15}$/.test(v)) return toast('L’identifiant Telegram est un nombre (ex. 123456789).');
    try { await saveSettings({ telegram_chat_id: v || null }); toast(v ? 'Alertes Telegram activées.' : 'Alertes Telegram désactivées.'); } catch (x) { toast(x.message, 5000); }
  };
  $('#gCache', root).onclick = () => { clearCatalogCache(); toast('Cache vidé.'); };
  $('#gExport', root).onclick = () => {
    const data = { app: 'farde', version: 1, exportedAt: new Date().toISOString(), settings: S.settings, binders: S.binders, collection: S.cards, sealed: S.sealed, wishlist: S.wish, history: S.history };
    download(`farde-sauvegarde-${today()}.json`, JSON.stringify(data, null, 1), 'application/json'); toast('Sauvegarde téléchargée.');
  };
  $('#gReset', root).onclick = async (e) => {
    if (!confirmButton(e.target, 'Clique encore pour tout effacer')) return;
    try { await deleteEverything(); toast('Collection effacée.'); } catch (x) { toast(x.message, 5000); }
  };
}
export function update() { /* rien à rafraîchir en direct */ }
