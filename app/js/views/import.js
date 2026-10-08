// Import d'un tableur (Google Sheets, Excel, CSV) avec rapprochement automatique du catalogue.
import { S, bulkInsertCards, updateCard } from '../store.js';
import { FIELDS, autoMap, rowToSpec, matchSpec } from '../match.js';
import { getSets, getSet, searchByName, searchCards } from '../tcgdex.js';
import { CONDITIONS, variantLabel } from '../valuation.js';
import { esc, eur, cardImg, langOptions, LANGS, pool, toast, download, toCsv, openDialog, closeDialog, $, $$ } from '../ui.js';

const PAGE = 100;
let st = fresh();
let root;
function fresh() {
  return { step: 'source', fileName: '', sheets: null, sheet: null, raw: [], hasHeader: true, map: {}, defaults: { lang: null, condition: 'NM', binder: undefined },
    merge: false, results: [], filter: 'todo', shown: PAGE, running: false, imported: null };
}

const src = {
  getSets: (lang) => getSets(lang),
  getSetsAlt: (lang) => (lang === 'en' ? Promise.resolve([]) : getSets('en')),
  getSet: (lang, id) => getSet(lang, id),
  searchByName: (lang, name) => searchByName(lang, name),
};

export function render(el) {
  st.defaults.lang = st.defaults.lang || S.settings.default_lang || 'fr';
  if (st.defaults.binder === undefined || (st.defaults.binder && !S.binders.some((b) => b.id === st.defaults.binder))) st.defaults.binder = S.binders[0]?.id || '';
  el.innerHTML = `<section class="view">
    <div class="vh"><div><h2>Importer un tableur</h2><p>Google Sheets, Excel ou CSV : chaque ligne est rapprochée du catalogue, tu vérifies les cas douteux, puis tout part dans ta collection.</p></div>
      <button class="btn" id="iTpl">Télécharger un modèle</button></div>
    <div class="steps" id="iSteps"></div>
    <div id="iBody"></div>
  </section>`;
  root = el.firstElementChild;
  $('#iTpl', root).onclick = () => download('modele-import-farde.csv', toCsv(
    ['Nom', 'Numéro', 'Série', 'Langue', 'État', 'Quantité', "Prix d'achat", "Date d'achat", 'Variante', 'Gradation', 'Notes'],
    [['Dracaufeu ex', '199/165', '151', 'FR', 'NM', '1', '60,00', '12/03/2024', '', '', 'Exemple à remplacer'],
     ['Pikachu', '173/165', '151', 'FR', 'NM', '2', '4,50', '', 'Reverse', '', ''],
     ['Mew ex', '232/091', 'Destinées de Paldea', 'FR', '', '1', '35', '', '', 'PSA 10', '']]), 'text/csv;charset=utf-8');
  draw();
}
export function update() { /* l'import garde son propre état */ }

function steps() {
  const L = [['source', '1. Fichier'], ['map', '2. Colonnes'], ['review', '3. Vérification'], ['done', '4. Terminé']];
  const cur = st.step === 'match' ? 'review' : st.step;
  $('#iSteps', root).innerHTML = L.map(([k, v]) => `<span ${k === cur ? 'aria-current="step"' : ''}>${v}</span>`).join('');
}

function draw() {
  if (!root?.isConnected) return;
  steps();
  ({ source: drawSource, map: drawMap, match: drawMatch, review: drawReview, done: drawDone })[st.step]();
}

// ---------------------------------------------------------------- 1. Source
function drawSource() {
  $('#iBody', root).innerHTML = `<div class="grid2">
    <div class="stack">
      <label class="drop" id="iDrop" for="iFile"><b>Glisse ton fichier ici</b><span class="muted small">ou clique pour le choisir · .xlsx, .xls, .ods, .csv</span>
        <input type="file" id="iFile" accept=".csv,.tsv,.txt,.xlsx,.xls,.ods,text/csv" hidden></label>
      <div class="panel stack"><h3>Lien Google Sheets</h3>
        <p class="note">Dans Google Sheets : Partager › Accès général › « Tous les utilisateurs disposant du lien », puis colle le lien.</p>
        <div class="row" style="flex-wrap:nowrap"><input type="url" id="iUrl" placeholder="https://docs.google.com/spreadsheets/d/…"><button class="btn pri" id="iUrlGo">Charger</button></div></div>
    </div>
    <div class="panel stack"><h3>Copier-coller</h3>
      <p class="note">Sélectionne tes cellules dans Google Sheets ou Excel (titres compris), copie-les et colle-les ici. C’est la méthode la plus simple.</p>
      <textarea id="iPaste" rows="9" placeholder="Nom	Numéro	Série	Langue	Prix d'achat&#10;Dracaufeu ex	199/165	151	FR	60,00"></textarea>
      <div class="row end"><button class="btn pri" id="iPasteGo">Utiliser ce texte</button></div></div>
  </div>
  <p class="loss" id="iErr" role="alert"></p>
  <p class="note">Colonnes reconnues automatiquement : nom, numéro (199 ou 199/165), série (nom français, anglais ou code comme MEW), langue, état, quantité, prix et date d’achat, variante (reverse, holo), gradation (PSA 10…), notes. Seul le nom ou le numéro est obligatoire.</p>`;
  const drop = $('#iDrop', root), err = (m) => ($('#iErr', root).textContent = m);
  $('#iFile', root).onchange = (e) => e.target.files[0] && loadFile(e.target.files[0]).catch((x) => err(x.message));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) loadFile(f).catch((x) => err(x.message)); });
  $('#iPasteGo', root).onclick = () => {
    const t = $('#iPaste', root).value;
    if (!t.trim()) return err('Colle d’abord tes cellules dans la zone de texte.');
    st.fileName = 'Texte collé'; st.sheets = null; setRaw(parseDelimited(t)); };
  $('#iUrlGo', root).onclick = async () => {
    const b = $('#iUrlGo', root); b.disabled = true; b.innerHTML = '<span class="spin"></span>';
    try { await loadSheetUrl($('#iUrl', root).value.trim()); } catch (x) { err(x.message); } finally { b.disabled = false; b.textContent = 'Charger'; }
  };
}

/** Lecture CSV / TSV avec guillemets ; détecte le séparateur. */
export function parseDelimited(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const counts = { '\t': first.split('\t').length, ';': first.split(';').length, ',': first.split(',').length };
  const sep = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

async function loadFile(f) {
  if (f.size > 15 * 1024 * 1024) throw new Error('Fichier trop lourd (15 Mo maximum).');
  st.fileName = f.name;
  if (/\.(csv|tsv|txt)$/i.test(f.name)) { st.sheets = null; setRaw(parseDelimited(await f.text())); return; }
  const { read, utils } = await import('../vendor/xlsx.js');
  const wb = read(await f.arrayBuffer(), { type: 'array', cellDates: true });
  st.sheets = wb.SheetNames.map((n) => ({ name: n, rows: utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }).filter((r) => r.some((c) => String(c).trim() !== '')) }))
    .filter((s) => s.rows.length);
  if (!st.sheets.length) throw new Error('Ce classeur ne contient aucune donnée.');
  st.sheet = st.sheets.reduce((a, b) => (b.rows.length > a.rows.length ? b : a)).name;
  setRaw(st.sheets.find((s) => s.name === st.sheet).rows);
}

async function loadSheetUrl(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) throw new Error('Ce n’est pas un lien Google Sheets. Il doit ressembler à https://docs.google.com/spreadsheets/d/…');
  const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1] || '0';
  const tries = [`https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`, `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv&gid=${gid}`];
  for (const u of tries) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const t = await r.text();
      if (/^\s*<(!doctype|html)/i.test(t)) continue;
      st.fileName = 'Google Sheets'; st.sheets = null; setRaw(parseDelimited(t)); return;
    } catch { /* on essaie l'adresse suivante */ }
  }
  throw new Error('Impossible de lire ce Google Sheets. Vérifie qu’il est partagé à « Tous les utilisateurs disposant du lien », ou utilise le copier-coller.');
}

function setRaw(rows) {
  if (!rows.length) throw new Error('Aucune ligne trouvée.');
  if (rows.length > 20001) throw new Error('Plus de 20 000 lignes : découpe ton fichier en plusieurs imports.');
  const w = Math.max(...rows.map((r) => r.length));
  st.raw = rows.map((r) => Array.from({ length: w }, (_, i) => r[i] ?? ''));
  const headerMap = autoMap(st.raw[0].map(String));
  st.hasHeader = Object.keys(headerMap).length >= 1 && st.raw[0].filter((c) => typeof c === 'string' && c.trim() && isNaN(Number(c))).length >= Math.ceil(w / 2);
  st.map = st.hasHeader ? headerMap : guessMapNoHeader();
  st.step = 'map';
  draw();
}
function guessMapNoHeader() {
  // Sans titres : première colonne de texte = nom, colonne du type 199/165 = numéro
  const sample = st.raw.slice(0, 20), w = st.raw[0].length, map = {};
  for (let i = 0; i < w; i++) {
    const vals = sample.map((r) => String(r[i]).trim()).filter(Boolean);
    if (map.number == null && vals.length && vals.filter((v) => /^[A-Za-z]{0,4}\d{1,3}(\s*\/\s*[A-Za-z]{0,4}\d{1,3})?$/.test(v)).length >= vals.length * 0.7) map.number = i;
    else if (map.name == null && vals.length && vals.filter((v) => /[A-Za-zÀ-ÿ]{3,}/.test(v)).length >= vals.length * 0.7) map.name = i;
  }
  return map;
}
const colName = (i) => { const h = st.hasHeader ? String(st.raw[0][i] ?? '').trim() : ''; let s = '', n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return h ? `${s} · ${h}` : `Colonne ${s}`; };
const dataRows = () => (st.hasHeader ? st.raw.slice(1) : st.raw);

// ---------------------------------------------------------------- 2. Colonnes
function drawMap() {
  const w = st.raw[0].length, rows = dataRows();
  const opts = (sel) => `<option value="">— ignorer —</option>` + Array.from({ length: w }, (_, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(colName(i))}</option>`).join('');
  const prev = st.raw.slice(0, 6);
  $('#iBody', root).innerHTML = `<div class="panel stack">
    <div class="row between"><div><b>${esc(st.fileName)}</b> <span class="muted">· ${rows.length.toLocaleString('fr-FR')} ligne${rows.length > 1 ? 's' : ''}</span></div>
      <div class="row">${st.sheets && st.sheets.length > 1 ? `<label class="row small" style="gap:6px">Onglet <select id="iSheet" style="width:auto">${st.sheets.map((s) => `<option ${s.name === st.sheet ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>` : ''}
      <label class="row small" style="gap:6px"><input type="checkbox" id="iHdr" ${st.hasHeader ? 'checked' : ''}> La première ligne contient les titres</label></div></div>
    <div class="tw"><table class="preview"><tbody>${prev.map((r, ri) => `<tr>${r.map((c) => `<${ri === 0 && st.hasHeader ? 'th' : 'td'}>${esc(c instanceof Date ? c.toLocaleDateString('fr-FR') : c)}</${ri === 0 && st.hasHeader ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</tbody></table></div>
  </div>
  <div class="panel stack"><h3>Quelle colonne contient quoi ?</h3>
    <div class="mapgrid">${FIELDS.map((f) => `<div class="field"><label for="m-${f.key}">${f.label}</label><select id="m-${f.key}" data-f="${f.key}">${opts(st.map[f.key])}</select></div>`).join('')}</div>
  </div>
  <div class="panel stack"><h3>Valeurs par défaut</h3>
    <div class="mapgrid">
      <div class="field"><label for="dLang">Langue si non précisée</label><select id="dLang">${langOptions(st.defaults.lang)}</select></div>
      <div class="field"><label for="dCond">État si non précisé</label><select id="dCond">${CONDITIONS.map(([k, n]) => `<option value="${k}" ${k === st.defaults.condition ? 'selected' : ''}>${k} · ${n}</option>`).join('')}</select></div>
      <div class="field"><label for="dBind">Ranger dans la farde</label><select id="dBind"><option value="">Aucune</option>${S.binders.map((b) => `<option value="${b.id}" ${b.id === st.defaults.binder ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
    </div>
    <label class="row small" style="gap:6px"><input type="checkbox" id="dMerge" ${st.merge ? 'checked' : ''}> Si la carte est déjà dans ma collection (même langue, variante, état), additionner les quantités au lieu de créer une nouvelle ligne</label>
  </div>
  <p class="loss" id="mErr" role="alert"></p>
  <div class="row between"><button class="btn" id="mBack">Changer de fichier</button><button class="btn pri" id="mGo">Rapprocher ${rows.length.toLocaleString('fr-FR')} ligne${rows.length > 1 ? 's' : ''} du catalogue</button></div>`;
  $$('select[data-f]', root).forEach((s) => s.onchange = () => { const v = s.value === '' ? undefined : +s.value; if (v === undefined) delete st.map[s.dataset.f]; else st.map[s.dataset.f] = v; });
  $('#iHdr', root).onchange = (e) => { st.hasHeader = e.target.checked; st.map = st.hasHeader ? autoMap(st.raw[0].map(String)) : guessMapNoHeader(); drawMap(); };
  const sh = $('#iSheet', root); if (sh) sh.onchange = () => { st.sheet = sh.value; setRaw(st.sheets.find((s) => s.name === st.sheet).rows); };
  $('#mBack', root).onclick = () => { st = { ...fresh(), defaults: st.defaults }; draw(); };
  $('#mGo', root).onclick = () => {
    if (st.map.name == null && st.map.number == null && st.map.card_id == null) { $('#mErr', root).textContent = 'Indique au moins la colonne du nom ou du numéro de la carte.'; return; }
    st.defaults = { lang: $('#dLang', root).value, condition: $('#dCond', root).value, binder: $('#dBind', root).value };
    st.merge = $('#dMerge', root).checked;
    runMatch();
  };
}

// ---------------------------------------------------------------- 3. Rapprochement
async function runMatch() {
  const rows = dataRows();
  st.results = rows.map((r, i) => ({ i, row: r, spec: rowToSpec(r, st.map, st.defaults), res: null, choice: null, skip: false, picked: false }));
  st.step = 'match'; st.running = true; st.done = 0; draw();
  // Les lignes avec série sont traitées d'abord par série pour profiter du cache
  const order = [...st.results].sort((a, b) => `${a.spec.lang}|${a.spec.setText}`.localeCompare(`${b.spec.lang}|${b.spec.setText}`));
  await pool(order, 4, async (r) => {
    try { r.res = await matchSpec(r.spec, src); }
    catch (e) { r.res = { status: 'notfound', card: null, candidates: [], reason: `Erreur réseau : ${e.message}` }; }
    r.choice = r.res.card;
  }, (d, n) => { st.done = d; if (st.step === 'match' && root?.isConnected) { const p = $('#mProg', root); if (p) { p.style.width = `${(d / n) * 100}%`; $('#mTxt', root).textContent = `${d.toLocaleString('fr-FR')} / ${n.toLocaleString('fr-FR')}`; } } });
  st.running = false; st.step = 'review';
  st.filter = st.results.some((r) => r.res.status !== 'ok') ? 'todo' : 'all';
  draw();
}
function drawMatch() {
  $('#iBody', root).innerHTML = `<div class="panel stack"><h3>Rapprochement avec le catalogue…</h3><div class="progress"><i id="mProg" style="width:0%"></i></div>
    <div class="row between small muted"><span id="mTxt">0 / ${st.results.length}</span><span>Les séries déjà vues sont mises en cache : les gros fichiers accélèrent en cours de route.</span></div></div>`;
}

// ---------------------------------------------------------------- 4. Vérification
const STATUS = { ok: ['ok', 'Reconnue'], verify: ['al', 'À vérifier'], ambiguous: ['al', 'À choisir'], notfound: ['err', 'Introuvable'] };
const stateOf = (r) => (r.skip ? 'skip' : r.picked ? 'ok' : r.res.status);
function counts() {
  const c = { ok: 0, verify: 0, ambiguous: 0, notfound: 0, skip: 0 };
  for (const r of st.results) c[stateOf(r)]++;
  return c;
}
const importable = () => st.results.filter((r) => !r.skip && r.choice);

function drawReview() {
  const c = counts(), imp = importable(), qty = imp.reduce((a, r) => a + r.spec.qty, 0);
  const dup = imp.filter((r) => S.cards.some((l) => l.lang === r.spec.lang && l.card_id === r.choice.id)).length;
  const F = [['todo', `À traiter (${c.verify + c.ambiguous + c.notfound})`], ['all', `Toutes (${st.results.length})`], ['ok', `Reconnues (${c.ok})`], ['verify', `À vérifier (${c.verify})`], ['ambiguous', `À choisir (${c.ambiguous})`], ['notfound', `Introuvables (${c.notfound})`], ['skip', `Ignorées (${c.skip})`]];
  $('#iBody', root).innerHTML = `<div class="panel stack">
    <div class="row between"><div class="row">${['ok', 'verify', 'ambiguous', 'notfound'].map((k) => `<span class="pill ${STATUS[k][0]}">${c[k]} ${STATUS[k][1].toLowerCase()}${c[k] > 1 && k !== 'verify' && k !== 'ambiguous' ? 's' : ''}</span>`).join('')}</div>
      <button class="btn sm" id="rBack">Revenir aux colonnes</button></div>
    <p class="note">« Reconnue » et « À vérifier » seront importées avec la carte proposée. Pour « À choisir », clique sur la bonne carte. Les lignes « Introuvables » ne sont pas importées tant que tu ne leur choisis pas une carte.</p>
    <div class="tabs" id="rTabs">${F.map(([k, v]) => `<button data-f="${k}" aria-pressed="${st.filter === k}">${v}</button>`).join('')}</div>
  </div>
  <div class="panel" style="padding:0" id="rList"></div>
  <div class="row" id="rMoreRow" hidden><button class="btn" id="rMore">Afficher plus</button></div>
  <div class="bulk"><b>${imp.length.toLocaleString('fr-FR')} ligne${imp.length > 1 ? 's' : ''} · ${qty.toLocaleString('fr-FR')} carte${qty > 1 ? 's' : ''} à importer</b>
    ${dup ? `<span class="small">${dup} déjà dans ta collection${st.merge ? ' (quantités additionnées)' : ''}</span>` : ''}
    <span style="flex:1"></span><button class="btn sm" id="rSkipNF">Ignorer les introuvables</button><button class="btn sm" id="rGo" style="background:var(--on-btn);color:var(--btn);border-color:var(--on-btn)" ${imp.length ? '' : 'disabled'}>Importer</button></div>`;
  $('#rTabs', root).onclick = (e) => { const b = e.target.closest('button[data-f]'); if (b) { st.filter = b.dataset.f; st.shown = PAGE; drawReview(); } };
  $('#rBack', root).onclick = () => { st.step = 'map'; draw(); };
  $('#rMore', root).onclick = () => { st.shown += PAGE; list(); };
  $('#rSkipNF', root).onclick = () => { st.results.forEach((r) => { if (stateOf(r) === 'notfound') r.skip = true; }); drawReview(); };
  $('#rGo', root).onclick = doImport;
  $('#rList', root).onclick = onListClick;
  list();
}

function filteredResults() {
  return st.results.filter((r) => {
    const s = stateOf(r);
    if (st.filter === 'all') return true;
    if (st.filter === 'todo') return s === 'verify' || s === 'ambiguous' || s === 'notfound';
    return s === st.filter;
  });
}

function list() {
  const L = filteredResults(), shown = L.slice(0, st.shown);
  $('#rList', root).innerHTML = shown.length ? shown.map(rowHtml).join('') : `<div class="empty" style="border:0">Rien ici.${st.filter === 'todo' ? ' Tout est prêt : clique sur Importer.' : ''}</div>`;
  $('#rMoreRow', root).hidden = L.length <= st.shown;
}

function rowHtml(r) {
  const s = stateOf(r), sp = r.spec;
  const srcTxt = [sp.rawName || '(sans nom)', sp.local ? `n° ${sp.local}${sp.total ? '/' + sp.total : ''}` : '', sp.setText, LANGS[sp.lang] ? sp.lang.toUpperCase() : ''].filter(Boolean).map(esc).join(' · ');
  const extra = [sp.qty > 1 ? `×${sp.qty}` : '', sp.buyPrice != null ? eur(sp.buyPrice) : '', sp.condition !== 'NM' ? sp.condition : '', sp.variant && sp.variant !== 'normal' ? variantLabel(sp.variant) : '', sp.grading ? `${sp.grading.company} ${sp.grading.grade}` : ''].filter(Boolean).map(esc).join(' · ');
  const pill = s === 'skip' ? `<span class="pill">Ignorée</span>` : `<span class="pill ${STATUS[s][0]}">${r.picked ? 'Choisie' : STATUS[s][1]}</span>`;
  const ch = r.choice;
  const quick = !ch && r.res.candidates.length ? `<div class="row" style="gap:6px;margin-top:6px">${r.res.candidates.slice(0, 5).map((c, k) => `<button class="tile" style="width:56px" data-pick="${r.i}" data-k="${k}" title="${esc(c.name)} · ${esc(c.setName || '')} ${esc(c.localId)}"><div class="img">${cardImg(c.image, c.name)}</div><span class="small num ellip">${esc(c.localId)}</span></button>`).join('')}</div>` : '';
  return `<div class="ir-row" data-row="${r.i}">
    ${ch ? cardImg(ch.image, ch.name, 'thumb') : '<div class="thumb ph"></div>'}
    <div class="ir-src" style="min-width:0"><div class="ellip"><span class="muted">L${r.i + (st.hasHeader ? 2 : 1)}</span> ${srcTxt}</div>${extra ? `<div class="sub">${extra}</div>` : ''}</div>
    <div style="min-width:0">${ch ? `<div class="ellip"><b>${esc(ch.name)}</b> <span class="num muted">${esc(ch.localId)}${ch.setTotal ? '/' + ch.setTotal : ''}</span></div><div class="sub ellip">${esc(ch.setName || ch.setId || '')}</div>` : ''}
      <div class="row" style="gap:6px">${pill}${r.res.reason && !r.picked ? `<span class="sub">${esc(r.res.reason)}</span>` : ''}</div>${quick}</div>
    <div class="row ir-act" style="gap:6px;justify-content:flex-end"><button class="btn sm" data-change="${r.i}">${ch ? 'Changer' : 'Choisir'}</button><button class="btn sm" data-skip="${r.i}">${r.skip ? 'Réintégrer' : 'Ignorer'}</button></div>
  </div>`;
}

function onListClick(e) {
  const pick = e.target.closest('[data-pick]');
  if (pick) { const r = st.results[+pick.dataset.pick]; r.choice = r.res.candidates[+pick.dataset.k]; r.picked = true; r.skip = false; refreshRow(r); return; }
  const sk = e.target.closest('[data-skip]');
  if (sk) { const r = st.results[+sk.dataset.skip]; r.skip = !r.skip; refreshRow(r); return; }
  const chg = e.target.closest('[data-change]');
  if (chg) picker(st.results[+chg.dataset.change]);
}
function refreshRow(r) {
  const el = $(`.ir-row[data-row="${r.i}"]`, root);
  if (el) el.outerHTML = rowHtml(r);
  // met à jour les compteurs sans perdre la position de défilement
  const y = scrollY; const f = st.filter; drawReview(); st.filter = f; scrollTo(0, y);
}

function picker(r) {
  const lang = r.spec.lang;
  const grid = (cands) => cands.length ? `<div class="cands">${cands.map((c, k) => `<button class="tile" data-c="${k}"><div class="img">${cardImg(c.image, c.name)}</div><div class="t1 ellip">${esc(c.name)}</div><div class="t2"><span class="ellip">${esc(c.setName || c.setId || '')}</span><span class="num">${esc(c.localId)}</span></div></button>`).join('')}</div>` : `<div class="empty">Aucune carte.</div>`;
  let current = r.res.candidates.slice();
  const d = openDialog(`<div class="mhead"><h3>Choisir la carte</h3><button class="btn sm" data-close aria-label="Fermer">✕</button></div>
    <div class="mbody"><p class="note">Ligne ${r.i + (st.hasHeader ? 2 : 1)} : <b>${esc(r.spec.rawName || '(sans nom)')}</b> ${esc(r.spec.local || '')} ${esc(r.spec.setText || '')}</p>
    <form class="row" id="pkForm" style="flex-wrap:nowrap"><input type="search" id="pkQ" value="${esc(r.spec.name)}" placeholder="Nom de la carte"><select id="pkLang" style="width:auto">${langOptions(lang)}</select><button class="btn pri">Chercher</button></form>
    <div id="pkRes">${grid(current)}</div></div>`);
  $('#pkForm', d).onsubmit = async (e) => {
    e.preventDefault();
    $('#pkRes', d).innerHTML = '<span class="spin"></span>';
    const l = $('#pkLang', d).value;
    try {
      const [res, sets] = await Promise.all([searchCards(l, { q: $('#pkQ', d).value.trim(), mode: 'name' }), getSets(l)]);
      const byId = new Map(sets.map((s) => [s.id, s]));
      current = res.slice(0, 120).map((c) => { const sid = c.id.slice(0, c.id.lastIndexOf('-')); const s = byId.get(sid); return { ...c, setId: sid, setName: s?.name || sid, setTotal: s?.cardCount?.official ?? null, lang: l }; });
      $('#pkRes', d).innerHTML = grid(current);
    } catch (x) { $('#pkRes', d).innerHTML = `<p class="loss">${esc(x.message)}</p>`; }
  };
  $('#pkRes', d).onclick = (e) => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    const c = current[+b.dataset.c];
    r.choice = c; if (c.lang) r.spec.lang = c.lang; r.picked = true; r.skip = false;
    closeDialog(); refreshRow(r);
  };
}

// ---------------------------------------------------------------- Import
async function doImport() {
  const rows = importable();
  if (!rows.length) return;
  const btn = $('#rGo', root); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Import…';
  const toInsert = [], merges = new Map();
  for (const r of rows) {
    const sp = r.spec, c = r.choice;
    const variant = sp.variant || 'normal';
    const line = {
      lang: sp.lang, card_id: c.id, name: c.name, local_id: c.localId ?? null, set_id: c.setId ?? null, set_name: c.setName ?? null,
      set_total: c.setTotal ?? null, image: c.image ?? null, rarity: null, variant, condition: sp.condition, qty: sp.qty,
      buy_price: sp.buyPrice, buy_date: sp.buyDate, binder_id: st.defaults.binder || null,
      grading_company: sp.grading?.company ?? null, grade: sp.grading?.grade ?? null, manual_price: sp.manualPrice, notes: sp.notes, source: 'import',
    };
    if (st.merge && !line.grading_company) {
      const ex = S.cards.find((l) => l.lang === line.lang && l.card_id === line.card_id && l.variant === line.variant && l.condition === line.condition && !l.grading_company);
      if (ex) {
        const m = merges.get(ex.id) || { qty: ex.qty, cost: ex.buy_price != null ? ex.buy_price * ex.qty : null, priced: ex.buy_price != null ? ex.qty : 0 };
        m.qty += line.qty;
        if (line.buy_price != null) { m.cost = (m.cost || 0) + line.buy_price * line.qty; m.priced += line.qty; }
        merges.set(ex.id, m);
        continue;
      }
    }
    toInsert.push(line);
  }
  try {
    for (const [id, m] of merges) await updateCard(id, { qty: Math.min(9999, m.qty), buy_price: m.priced ? Math.round((m.cost / m.priced) * 100) / 100 : null });
    await bulkInsertCards(toInsert, (d, n) => { btn.innerHTML = `<span class="spin"></span> ${d}/${n}`; });
    st.imported = { lines: toInsert.length, merged: merges.size, cards: rows.reduce((a, r) => a + r.spec.qty, 0) };
    st.step = 'done'; draw();
  } catch (e) {
    toast(e.message, 6000); btn.disabled = false; btn.textContent = 'Réessayer l’import';
  }
}

// ---------------------------------------------------------------- Terminé
function drawDone() {
  const left = st.results.filter((r) => r.skip || !r.choice);
  $('#iBody', root).innerHTML = `<div class="panel stack"><h3>Import terminé</h3>
    <p>${st.imported.cards.toLocaleString('fr-FR')} carte${st.imported.cards > 1 ? 's' : ''} ajoutée${st.imported.cards > 1 ? 's' : ''} : ${st.imported.lines} nouvelle${st.imported.lines > 1 ? 's' : ''} ligne${st.imported.lines > 1 ? 's' : ''}${st.imported.merged ? `, ${st.imported.merged} ligne${st.imported.merged > 1 ? 's' : ''} existante${st.imported.merged > 1 ? 's' : ''} complétée${st.imported.merged > 1 ? 's' : ''}` : ''}.</p>
    <p class="note">Les cotes s’affichent au fur et à mesure dans ta collection, puis sont mises à jour chaque matin automatiquement.</p>
    <div class="row">${left.length ? `<button class="btn" id="dLeft">Télécharger les ${left.length} ligne${left.length > 1 ? 's' : ''} non importée${left.length > 1 ? 's' : ''}</button>` : ''}
      <button class="btn" id="dAgain">Importer un autre fichier</button><a class="btn pri" href="#collection">Voir ma collection</a></div></div>`;
  const b = $('#dLeft', root);
  if (b) b.onclick = () => download('lignes-non-importees.csv', toCsv(st.hasHeader ? st.raw[0].map(String) : st.raw[0].map((_, i) => colName(i)), left.map((r) => r.row.map((c) => (c instanceof Date ? c.toLocaleDateString('fr-FR') : c)))), 'text/csv;charset=utf-8');
  $('#dAgain', root).onclick = () => { st = { ...fresh(), defaults: st.defaults }; draw(); };
}
