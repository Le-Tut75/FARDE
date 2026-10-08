import { S, sb, saveSettings, deleteEverything, loadAll, backupData, restoreBackup, listShowcases, createShowcase, deleteShowcase } from '../store.js';
import { CONDITIONS, BASES } from '../valuation.js';
import { clearCatalogCache } from '../tcgdex.js';
import { esc, langOptions, toast, num, download, today, frDateTime, frDate, confirmButton, $, $$ } from '../ui.js';

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
          <p class="note">Reçois un message quand une carte de ta wishlist passe sous ton prix cible ou apparaît dans les Opportunités, et quand une carte de ta collection bouge fortement (±25 % en 7 jours). Indique ton identifiant Telegram (voir le guide d’installation, étape facultative).</p>
          <div class="row" style="flex-wrap:nowrap"><input type="text" id="gTg" inputmode="numeric" value="${esc(s.telegram_chat_id || '')}" placeholder="Ex. 123456789"><button class="btn" id="gTgSave">Enregistrer</button></div>
        </div>
      </div>
      <div class="panel stack"><h3>Mon compte</h3>
        <form class="stack" id="gPwForm"><div class="field"><label for="gPw">Nouveau mot de passe</label><input id="gPw" type="password" minlength="8" autocomplete="new-password" placeholder="8 caractères minimum" required></div>
        <button class="btn" style="align-self:flex-start">Changer mon mot de passe</button></form>
      </div>
      <div class="panel stack"><h3>Affichage</h3>
        <div class="field"><label for="gTheme">Thème</label><select id="gTheme"><option value="">Comme le système</option><option value="light">Clair</option><option value="dark">Sombre</option></select></div>
        <button class="btn" id="gCache" style="align-self:flex-start">Vider le cache du catalogue</button>
      </div>
      <div class="panel stack"><h3>Vitrine (lien à partager)</h3>
        <p class="note">Un lien en lecture seule vers ta collection ou une farde : tes amis la voient sans compte. Tes prix d’achat et tes notes ne sont jamais montrés.</p>
        <div class="fgrid" style="grid-template-columns:repeat(2,minmax(0,1fr))">
          <div class="field"><label for="gScope">Ce qui est montré</label><select id="gScope"><option value="">Toute ma collection</option>${S.binders.map((b) => `<option value="${b.id}">Farde : ${esc(b.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="gTitle">Titre</label><input id="gTitle" type="text" maxlength="80" placeholder="La collection d’Arthur"></div>
        </div>
        <label class="row small" style="gap:6px"><input type="checkbox" id="gVals" checked> Afficher les cotes</label>
        <button class="btn" id="gShow" style="align-self:flex-start">Créer un lien</button>
        <div id="gLinks" class="stack" style="gap:8px"></div>
      </div>
      <div class="panel stack"><h3>Mes données</h3>
        <p class="note">Tes données sont dans ta base Supabase, sauvegardée par Supabase. Tu peux aussi garder une copie de tout, et la restaurer ici (sur ce compte ou un autre).</p>
        <div class="row"><button class="btn" id="gExport">Télécharger une sauvegarde complète (.json)</button></div>
        <div class="row"><label class="btn" style="cursor:pointer">Restaurer une sauvegarde…<input type="file" id="gRestore" accept=".json,application/json" hidden></label></div>
        <div id="gRestoreBox"></div>
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
  $('#gPwForm', root).onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: $('#gPw', root).value });
    if (error) return toast(/same|different/i.test(error.message) ? 'Choisis un mot de passe différent de l’actuel.' : error.message, 5000);
    $('#gPw', root).value = ''; toast('Mot de passe changé.');
  };
  $('#gCache', root).onclick = () => { clearCatalogCache(); toast('Cache vidé.'); };
  $('#gExport', root).onclick = () => {
    download(`farde-sauvegarde-${today()}.json`, JSON.stringify(backupData(), null, 1), 'application/json'); toast('Sauvegarde téléchargée.');
  };
  $('#gRestore', root).onchange = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch { return toast('Fichier illisible : choisis un fichier .json téléchargé depuis Farde.', 5000); }
    if (data?.app !== 'farde' || !Array.isArray(data.collection)) return toast('Ce fichier n’est pas une sauvegarde Farde.', 5000);
    const box = $('#gRestoreBox', root);
    box.innerHTML = `<div class="panel stack" style="background:var(--ground);padding:14px">
      <b>Sauvegarde du ${frDate(data.exportedAt)}</b>
      <span class="note">${data.collection.length} lignes de cartes, ${(data.sealed || []).length} scellés, ${(data.wishlist || []).length} en wishlist, ${(data.expenses || []).length} dépenses, ${(data.sales || []).length} ventes.</span>
      <label class="row small" style="gap:6px"><input type="radio" name="rmode" value="replace" checked> Remplacer tout ce qu’il y a sur ce compte</label>
      <label class="row small" style="gap:6px"><input type="radio" name="rmode" value="merge"> Ajouter à ce qu’il y a déjà</label>
      <div class="row"><button class="btn pri" id="gRGo">Restaurer</button><button class="btn" id="gRNo">Annuler</button><span class="note" id="gRStep"></span></div></div>`;
    $('#gRNo', box).onclick = () => { box.innerHTML = ''; };
    $('#gRGo', box).onclick = async (ev) => {
      const mode = box.querySelector('input[name=rmode]:checked').value;
      if (mode === 'replace' && !confirmButton(ev.target, 'Confirmer : tout remplacer')) return;
      ev.target.disabled = true;
      try { await restoreBackup(data, mode, (m) => { const el = $('#gRStep', box); if (el) el.textContent = m; }); box.innerHTML = ''; toast('Sauvegarde restaurée.'); }
      catch (x) { toast(x.message, 6000); ev.target.disabled = false; }
    };
  };
  $('#gShow', root).onclick = async (e) => {
    e.target.disabled = true;
    try {
      await createShowcase({ binder_id: $('#gScope', root).value || null, title: $('#gTitle', root).value.trim() || null, show_values: $('#gVals', root).checked });
      $('#gTitle', root).value = ''; await links(); toast('Lien créé : copie-le et envoie-le.');
    } catch (x) { toast(/showcases/.test(x.message) ? 'Mets d’abord à jour la base (schema.sql de la version 1.4).' : x.message, 6000); }
    finally { e.target.disabled = false; }
  };
  $('#gLinks', root).addEventListener('click', async (e) => {
    const cp = e.target.closest('[data-copy]'), del = e.target.closest('[data-del]');
    if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); toast('Lien copié.'); } catch { prompt('Copie ce lien :', cp.dataset.copy); } }
    if (del) { if (!confirmButton(del, 'Confirmer')) return; try { await deleteShowcase(del.dataset.del); await links(); toast('Lien supprimé : il ne fonctionne plus.'); } catch (x) { toast(x.message, 5000); } }
  });
  links();
  $('#gReset', root).onclick = async (e) => {
    if (!confirmButton(e.target, 'Clique encore pour tout effacer')) return;
    try { await deleteEverything(); toast('Collection effacée.'); } catch (x) { toast(x.message, 5000); }
  };
}
export function update() { /* rien à rafraîchir en direct */ }

const showUrl = (t) => new URL(`vitrine.html?t=${t}`, location.href.split('#')[0]).href;
async function links() {
  const box = $('#gLinks', root); if (!box) return;
  let rows = [];
  try { rows = await listShowcases(); } catch { box.innerHTML = ''; return; }
  if (!box.isConnected) return;
  box.innerHTML = rows.map((r) => {
    const b = S.binders.find((x) => x.id === r.binder_id);
    return `<div class="row between linkrow"><div style="min-width:0"><b class="ellip" style="display:block">${esc(r.title || (b ? b.name : 'Toute ma collection'))}</b><span class="muted small">${b ? 'Farde ' + esc(b.name) : 'Toute la collection'}${r.show_values ? ' · avec cotes' : ' · sans cotes'}</span></div>
      <div class="row" style="flex-wrap:nowrap"><a class="btn sm" href="${showUrl(r.token)}" target="_blank" rel="noopener">Voir</a><button class="btn sm" data-copy="${showUrl(r.token)}">Copier</button><button class="btn sm dng" data-del="${r.token}">Supprimer</button></div></div>`;
  }).join('');
}
