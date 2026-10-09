// Ajout rapide : ouverture de boosters ou pile de cartes, par série (un clic = +1) ou au scan du numéro.
// Les cartes s'empilent dans une « pile » puis partent toutes ensemble dans la collection.
import { S, bulkInsertCards } from '../store.js';
import { getSet, getSets, getSeriesGroups, getCard } from '../tcgdex.js';
import { parseScan, isUseful, resolveScan } from '../scan.js';
import { lineCalc, variantLabel, CONDITIONS, VARIANTS } from '../valuation.js';
import { openExpenseDialog } from './expenses.js';
import { esc, eur, cardImg, langOptions, LANGS, toast, setPicker, frDate, today, $ } from '../ui.js';

const st = { mode: 'set', lang: null, setId: null, setName: '', expenseId: '', binderId: undefined, condition: 'NM', filter: '', tray: [], loaded: false };
const info = new Map();   // "lang:id" -> fiche complète (versions, cote)
let root, cam = null;

const trayKey = () => `farde.tray.${S.user?.id}`;
function saveTray() { try { localStorage.setItem(trayKey(), JSON.stringify(st.tray)); } catch {} }
function loadTray() { if (st.loaded) return; st.loaded = true; try { st.tray = JSON.parse(localStorage.getItem(trayKey()) || '[]') || []; } catch { st.tray = []; } }

export function render(el) {
  loadTray();
  const qp = new URLSearchParams(location.hash.split('?')[1] || '');
  if (qp.get('mode') === 'scan') st.mode = 'scan';
  if (qp.get('mode') === 'set') st.mode = 'set';
  if (qp.has('exp') && S.expenses.some((e) => e.id === qp.get('exp'))) { st.expenseId = qp.get('exp'); st.mode = qp.get('mode') || 'set'; }
  st.lang = st.lang || S.settings.default_lang || 'fr';
  if (st.binderId === undefined) st.binderId = S.binders[0]?.id || '';
  el.innerHTML = `<section class="view">
    <div class="vh"><div><h2>Scanner ou cliquer tes cartes</h2><p>Scanne le numéro en bas de chaque carte, ou choisis la série ouverte et clique sur les cartes tirées. Elles s’empilent à droite ; rien n’est enregistré avant « Ajouter à ma collection ».</p></div></div>
    <div class="panel qa-opts">
      <div class="field"><label for="qExp">Ouverture ou lot</label><select id="qExp"></select></div>
      <div class="field"><label for="qLang">Langue des cartes</label><select id="qLang">${langOptions(st.lang)}</select></div>
      <div class="field"><label for="qBind">Farde</label><select id="qBind"></select></div>
      <div class="field"><label for="qCond">État</label><select id="qCond">${CONDITIONS.map(([k, n]) => `<option value="${k}" ${k === st.condition ? 'selected' : ''}>${k} · ${n}</option>`).join('')}</select></div>
    </div>
    <div class="qa">
      <div class="stack" style="min-width:0">
        <div class="tabs" role="tablist"><button type="button" data-mode="set">Par série</button><button type="button" data-mode="scan">Scanner</button></div>
        <div id="qBody"></div>
      </div>
      <aside class="panel tray" id="qTray" aria-label="Pile de cartes à ajouter"></aside>
    </div>
  </section>`;
  root = el.firstElementChild;
  opts();
  $('#qExp', root).onchange = (e) => {
    if (e.target.value === '__new') {
      e.target.value = st.expenseId;
      openExpenseDialog(null, (r) => { st.expenseId = r.id; opts(); tray(); });
      return;
    }
    st.expenseId = e.target.value; tray();
  };
  $('#qLang', root).onchange = (e) => { st.lang = e.target.value; st.setId = null; st.setName = ''; body(); };
  $('#qBind', root).onchange = (e) => { st.binderId = e.target.value; };
  $('#qCond', root).onchange = (e) => { st.condition = e.target.value; };
  root.querySelector('.tabs').onclick = (e) => { const b = e.target.closest('[data-mode]'); if (b && b.dataset.mode !== st.mode) { st.mode = b.dataset.mode; body(); } };
  $('#qTray', root).addEventListener('click', onTrayClick);
  $('#qTray', root).addEventListener('change', onTrayChange);
  body(); tray();
}

export function leave() { stopCam(); }
export function update() { if (root?.isConnected) { opts(); tray(); } }

function opts() {
  const ex = $('#qExp', root);
  ex.innerHTML = `<option value="">Aucune (cartes achetées à l’unité)</option>${S.expenses.map((e) => `<option value="${e.id}">${esc(e.label)} · ${frDate(e.d)}</option>`).join('')}<option value="__new">+ Nouvelle ouverture ou lot…</option>`;
  ex.value = st.expenseId || '';
  const bd = $('#qBind', root);
  bd.innerHTML = S.binders.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('') + '<option value="">Aucune</option>';
  bd.value = st.binderId || '';
}

// ---------------- Pile ----------------
const keyOf = (c) => `${c.lang}:${c.id}:${c.variant || 'normal'}`;
function addToTray(c, { silent = false } = {}) {
  const variant = c.variant || 'normal';
  const k = keyOf({ ...c, variant });
  const ex = st.tray.find((t) => t.key === k);
  if (ex) ex.qty++;
  else st.tray.unshift({ key: k, id: c.id, lang: c.lang, name: c.name, localId: c.localId, setId: c.setId, setName: c.setName, setTotal: c.setTotal ?? null, image: c.image || null, variant, qty: 1 });
  saveTray(); tray(); marks();
  enrich(c.lang, c.id);
  if (!silent) navigator.vibrate?.(40);
}
async function enrich(lang, id) {
  const k = `${lang}:${id}`;
  if (info.has(k)) return;
  info.set(k, null);
  const card = await getCard(lang, id).catch(() => null);
  info.set(k, card);
  if (root?.isConnected) tray();
}
function versions(t) {
  const card = info.get(`${t.lang}:${t.id}`);
  const keys = card?.vd?.length ? [...new Set(card.vd.map((v) => v.key))] : card?.variants ? Object.keys(VARIANTS).filter((k) => card.variants[k]) : ['normal', 'reverse', 'holo'];
  if (!keys.includes(t.variant)) keys.unshift(t.variant);
  return keys;
}
function unitOf(t) {
  const card = info.get(`${t.lang}:${t.id}`);
  if (!card?.cm) return null;
  return lineCalc({ variant: t.variant, qty: 1, condition: st.condition }, card.cm, S.settings).unit;
}

function tray() {
  const el = $('#qTray', root); if (!el) return;
  const n = st.tray.reduce((a, t) => a + t.qty, 0);
  const val = st.tray.reduce((a, t) => a + (unitOf(t) || 0) * t.qty, 0);
  const exp = S.expenses.find((e) => e.id === st.expenseId);
  el.innerHTML = `<div class="row between"><h3>Pile <span class="muted">(${n})</span></h3>${st.tray.length ? '<button type="button" class="btn sm ghost" data-clear>Vider</button>' : ''}</div>
    ${st.tray.length ? `<div class="tray-list">${st.tray.map((t, i) => `<div class="tray-it">
        ${cardImg(t.image, t.name, 'thumb')}
        <div style="min-width:0"><div class="ellip"><b>${esc(t.name)}</b> <span class="muted small num">${esc(t.localId || '')}${t.setTotal ? '/' + t.setTotal : ''}</span></div>
          <div class="muted small ellip">${esc(t.setName || '')} · ${esc(t.lang.toUpperCase())}${unitOf(t) != null ? ' · ' + eur(unitOf(t)) : ''}</div>
          <select data-var="${i}" aria-label="Version">${versions(t).map((k) => `<option value="${esc(k)}" ${k === t.variant ? 'selected' : ''}>${esc(variantLabel(k))}</option>`).join('')}</select></div>
        <div class="qty"><button type="button" data-dec="${i}" aria-label="Retirer un exemplaire">−</button><b class="num">${t.qty}</b><button type="button" data-inc="${i}" aria-label="Ajouter un exemplaire">+</button></div>
      </div>`).join('')}</div>
      <div class="tray-sum"><span>Valeur estimée</span><b class="num">${eur(val)}</b></div>
      ${exp ? `<p class="note">Rattachées à « ${esc(exp.label)} » (${eur(exp.amount)}), sans prix d’achat : le résultat de l’ouverture se calcule tout seul.</p>` : '<p class="note">Sans ouverture choisie, tu pourras saisir les prix d’achat ensuite dans la Liste.</p>'}
      <button type="button" class="btn pri" data-save style="width:100%">Ajouter ${n} carte${n > 1 ? 's' : ''} à ma collection</button>`
    : `<p class="note">${st.mode === 'scan' ? 'Les cartes scannées s’empilent ici.' : 'Clique sur une carte de la série : elle s’ajoute ici. Un 2e clic = un 2e exemplaire.'} Rien n’est enregistré tant que tu n’as pas validé.</p>`}`;
}
function onTrayClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.inc != null) { st.tray[+b.dataset.inc].qty++; }
  else if (b.dataset.dec != null) { const t = st.tray[+b.dataset.dec]; if (--t.qty <= 0) st.tray.splice(+b.dataset.dec, 1); }
  else if (b.dataset.clear != null) { if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Confirmer'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Vider'; } }, 3000); return; } st.tray = []; }
  else if (b.dataset.save != null) { save(b); return; }
  else return;
  saveTray(); tray(); marks();
}
function onTrayChange(e) {
  const s = e.target.closest('[data-var]'); if (!s) return;
  const t = st.tray[+s.dataset.var]; t.variant = s.value; t.key = keyOf(t);
  // Deux lignes identiques après changement de version : on les fusionne
  const dup = st.tray.find((x) => x !== t && x.key === t.key);
  if (dup) { dup.qty += t.qty; st.tray.splice(st.tray.indexOf(t), 1); }
  saveTray(); tray();
}
async function save(btn) {
  btn.disabled = true;
  const exp = S.expenses.find((e) => e.id === st.expenseId);
  const rows = st.tray.map((t) => {
    const card = info.get(`${t.lang}:${t.id}`);
    return { lang: t.lang, card_id: t.id, name: t.name, local_id: t.localId, set_id: t.setId, set_name: t.setName, set_total: t.setTotal, image: t.image,
      rarity: card?.rarity || null, variant: t.variant, condition: st.condition, qty: t.qty, buy_price: null, buy_date: exp?.d || today(),
      binder_id: st.binderId || null, expense_id: st.expenseId || null, source: 'ajout rapide', grading_company: null, grade: null, manual_price: null, notes: null };
  });
  try {
    await bulkInsertCards(rows);
    const n = rows.reduce((a, r) => a + r.qty, 0);
    st.tray = []; saveTray(); tray(); marks();
    toast(`${n} carte${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} à ta collection.${exp ? ' Résultat de l’ouverture dans Portefeuille › Dépenses.' : ''}`, 5000);
  } catch (err) { toast(err.message, 5000); btn.disabled = false; }
}

// ---------------- Modes ----------------
function body() {
  stopCam();
  root.querySelectorAll('.tabs [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === st.mode)));
  const el = $('#qBody', root);
  if (st.mode === 'set') {
    el.innerHTML = `<div class="row panel" style="padding:14px">
        <div class="field" style="flex:3 1 240px"><label for="qSet">Série ouverte</label><input id="qSet" type="text" value="${esc(st.setName)}"></div>
        <div class="field" style="flex:1 1 140px"><label for="qF">Numéro ou nom</label><input id="qF" type="search" placeholder="199, Dracaufeu…" value="${esc(st.filter)}"></div>
      </div>
      <div class="setgrid qa-grid" id="qGrid"></div>`;
    setPicker($('#qSet', root), () => getSeriesGroups(st.lang), (s) => { st.setId = s?.id || null; st.setName = s?.name || ''; grid(); }, { allLabel: 'Tape le nom de la série…' });
    $('#qF', root).oninput = (e) => { st.filter = e.target.value; grid(); };
    $('#qGrid', root).onclick = (e) => { const b = e.target.closest('.c[data-i]'); if (b) addToTray(gridCards[+b.dataset.i]); };
    grid();
  } else {
    el.innerHTML = `<div class="panel stack scanp">
        ${st.setId ? `<div class="row between"><span class="pill acc">Série : ${esc(st.setName)}</span><button type="button" class="btn sm ghost" id="qUnlock">Toutes les séries</button></div>` : ''}
        <div class="scan-cam" id="qCam" hidden><video id="qVid" playsinline muted autoplay></video><div class="scan-frame"><span>Le bas de la carte (numéro) dans ce cadre</span></div><div class="scan-flash" id="qFlash"></div></div>
        <div class="row"><button type="button" class="btn pri" id="qStart"><svg class="ic"><use href="#i-scan"/></svg>Activer la caméra</button>
          <button type="button" class="btn" id="qShot" hidden>Lire maintenant</button>
          <label class="btn" style="cursor:pointer">Prendre une photo<input type="file" id="qFile" accept="image/*" capture="environment" hidden></label></div>
        <div class="status" id="qStatus" aria-live="polite"></div>
        <div id="qChoices"></div>
        <form class="field" id="qCodeForm"><label for="qCode">Ou tape ce qui est écrit en bas de la carte</label>
          <div class="row" style="flex-wrap:nowrap"><input id="qCode" type="text" autocomplete="off" autocapitalize="characters" placeholder="${st.setId ? '199' : 'MEW 199/165, 025/202…'}"><button class="btn">Ajouter</button></div></form>
        <p class="note">Vise le bas de la carte : le code de série et le numéro (ex. « MEW FR 199/165 »). Sur les cartes plus anciennes sans code, le numéro « 25/102 » suffit ; s’il correspond à plusieurs séries, tu choisis. Pour une ouverture, choisis d’abord la série dans « Par série » : le numéro seul suffit alors.</p>
      </div>`;
    $('#qStart', root).onclick = startCam;
    $('#qShot', root).onclick = () => { if (cam) { cam.force = true; cam.pause = 0; } };
    $('#qFile', root).onchange = (e) => { const f = e.target.files?.[0]; if (f) readPhoto(f); e.target.value = ''; };
    $('#qCodeForm', root).onsubmit = async (e) => { e.preventDefault(); const v = $('#qCode', root).value.trim(); if (!v) return; const done = await handle(v, { typed: true }); if (done) $('#qCode', root).value = ''; $('#qCode', root).focus(); };
    $('#qUnlock', root)?.addEventListener('click', () => { st.setId = null; st.setName = ''; body(); });
    $('#qChoices', root).onclick = (e) => {
      const b = e.target.closest('[data-pick]'); if (!b) return;
      if (b.dataset.pick !== '') addToTray(choices[+b.dataset.pick]);
      $('#qChoices', root).innerHTML = ''; if (cam) cam.pause = Date.now() + 600;
    };
  }
}

let gridCards = [], gridSeq = 0;
async function grid() {
  const g = $('#qGrid', root); if (!g) return;
  if (!st.setId) { g.innerHTML = `<div class="empty" style="grid-column:1/-1">Choisis la série que tu ouvres : ses cartes s’affichent ici, il suffit de cliquer sur celles que tu as tirées.</div>`; return; }
  const my = ++gridSeq;
  g.innerHTML = '<span class="spin"></span>';
  const set = await getSet(st.lang, st.setId).catch(() => null);
  if (my !== gridSeq || !g.isConnected) return;
  if (!set) { g.innerHTML = `<div class="empty" style="grid-column:1/-1">Série introuvable en ${esc(LANGS[st.lang] || st.lang)}.</div>`; return; }
  const f = st.filter.trim().toLowerCase().replace(/^0+(?=\d)/, '');
  gridCards = set.cards.filter((c) => !f || String(c.localId).toLowerCase().replace(/^0+(?=\d)/, '') === f || c.name.toLowerCase().includes(f))
    .map((c) => ({ id: c.id, localId: c.localId, name: c.name, image: c.image, setId: set.id, setName: set.name, setTotal: set.cardCount?.official ?? null, lang: st.lang }));
  g.innerHTML = gridCards.map((c, i) => `<button type="button" class="c" data-i="${i}" title="${esc(c.name)}">${cardImg(c.image, c.name)}<span>${esc(c.localId)}</span></button>`).join('') || `<div class="empty" style="grid-column:1/-1">Aucune carte ne correspond.</div>`;
  marks();
}
function marks() {
  const g = $('#qGrid', root); if (!g) return;
  const cnt = new Map();
  for (const t of st.tray) if (t.lang === st.lang) cnt.set(t.id, (cnt.get(t.id) || 0) + t.qty);
  g.querySelectorAll('.c[data-i]').forEach((b) => {
    const n = cnt.get(gridCards[+b.dataset.i]?.id) || 0;
    b.classList.toggle('picked', n > 0);
    let badge = b.querySelector('.cnt');
    if (n && !badge) { badge = document.createElement('i'); badge.className = 'cnt'; b.appendChild(badge); }
    if (badge) { if (n) badge.textContent = '×' + n; else badge.remove(); }
  });
}

// ---------------- Scan ----------------
const src = { getSets, getSet };
let choices = [];
const status = (html) => { const s = $('#qStatus', root); if (s) s.innerHTML = html; };

/** Analyse un texte (lu ou tapé). Renvoie true si une carte a été ajoutée ou proposée. */
async function handle(text, { typed = false } = {}) {
  const p = parseScan(text);
  if (!isUseful(p) && !(st.setId && p.local)) {
    if (typed) status(`<span class="warn">Je ne reconnais pas « ${esc(text)} ». Tape le numéro avec le total (199/165) ou le code de série (MEW 199).</span>`);
    return false;
  }
  const lang = p.lang && LANGS[p.lang] ? p.lang : st.lang;
  const r = await resolveScan(p, src, { lang, lockSet: st.setId }).catch((e) => ({ status: 'notfound', reason: e.message }));
  if (r.status === 'ok') {
    const now = Date.now();
    if (!typed && cam && cam.last === r.card.id && now - cam.lastAt < 3000) return false;   // la même carte encore dans le cadre
    addToTray(r.card);
    if (cam) { cam.last = r.card.id; cam.lastAt = now; cam.pause = now + 1300; flash(); }
    status(`<span class="gain">✓ ${esc(r.card.name)} ${esc(r.card.localId)}${r.card.setTotal ? '/' + r.card.setTotal : ''} · ${esc(r.card.setName)}</span>`);
    return true;
  }
  if (r.status === 'ambiguous') {
    choices = r.candidates;
    if (cam) cam.pause = Infinity;
    $('#qChoices', root).innerHTML = `<div class="panel" style="background:var(--ground);padding:12px"><p class="note" style="margin-bottom:8px">${esc(r.reason)} : laquelle est-ce ?</p>
      <div class="cands">${choices.map((c, i) => `<button type="button" class="tile" data-pick="${i}"><div class="img">${cardImg(c.image, c.name)}</div><div class="t1 ellip">${esc(c.name)}</div><div class="t2"><span class="ellip">${esc(c.setName)}</span></div></button>`).join('')}</div>
      <div class="row end" style="margin-top:8px"><button type="button" class="btn sm" data-pick="">Aucune</button></div></div>`;
    status(`<span class="warn">Plusieurs cartes possibles pour ${esc(p.local)}${p.total ? '/' + p.total : ''}.</span>`);
    return true;
  }
  if (typed || (cam && cam.force)) status(`<span class="warn">${esc(r.reason || 'Carte introuvable')}.</span>`);
  return false;
}

async function startCam() {
  const btn = $('#qStart', root);
  if (!navigator.mediaDevices?.getUserMedia) { status('<span class="warn">Ce navigateur ne donne pas accès à la caméra : utilise « Prendre une photo » ou tape le numéro.</span>'); return; }
  btn.disabled = true;
  status('<span class="spin"></span> Préparation du lecteur (quelques secondes la première fois)…');
  try {
    const [stream] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }),
      import('../ocr.js').then((m) => m.getWorker()),
    ]);
    if (!root?.isConnected || st.mode !== 'scan') { stream.getTracks().forEach((t) => t.stop()); return; }
    const v = $('#qVid', root);
    v.srcObject = stream;
    await v.play().catch(() => {});
    $('#qCam', root).hidden = false; btn.hidden = true; $('#qShot', root).hidden = false;
    cam = { stream, v, busy: false, pause: 0, last: null, lastAt: 0, prev: null, force: false, timer: null };
    // Mise au point continue quand le téléphone le permet
    try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch {}
    status('Cadre le bas de la carte… la lecture est automatique.');
    tick();
  } catch (e) {
    btn.disabled = false;
    const m = e?.name === 'NotAllowedError' ? 'Accès à la caméra refusé. Autorise-le dans les réglages du navigateur, ou utilise « Prendre une photo ».'
      : e?.name === 'NotFoundError' ? 'Aucune caméra trouvée : utilise « Prendre une photo » ou tape le numéro.' : (e?.message || 'Caméra indisponible.');
    status(`<span class="warn">${esc(m)}</span>`);
  }
}
function stopCam() {
  if (!cam) return;
  clearTimeout(cam.timer);
  cam.stream.getTracks().forEach((t) => t.stop());
  cam = null;
}
function flash() { const f = $('#qFlash', root); if (!f) return; f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }

async function tick() {
  const c = cam; if (!c) return;
  const again = (ms) => { if (cam === c) c.timer = setTimeout(tick, ms); };
  if (c.busy || Date.now() < c.pause || !c.v.videoWidth) return again(250);
  c.busy = true;
  try {
    const { prepare, readText } = await import('../ocr.js');
    const W = c.v.videoWidth, H = c.v.videoHeight;
    // Même zone que le cadre affiché (voir .scan-frame)
    const sx = W * 0.06, sy = H * 0.40, sw = W * 0.88, sh = H * 0.20;
    let text = await readText(prepare(c.v, sx, sy, sw, sh));
    let p = parseScan(text);
    if (!isUseful(p) && !(st.setId && p.local)) { text = await readText(prepare(c.v, sx, sy, sw, sh, { invert: true })); p = parseScan(text); }
    if (cam !== c) return;
    const sig = `${p.setId}|${p.local}|${p.total}`;
    // On attend deux lectures identiques de suite (ou un code de série) pour éviter les erreurs
    const confident = c.force || (p.setId && p.local) || sig === c.prev;
    c.prev = sig;
    if (p.local && confident) { await handle(text); c.force = false; }
    else if (!p.local && Date.now() - (c.lastAt || 0) > 5000) status('Cadre le bas de la carte… la lecture est automatique.');
  } catch (e) { status(`<span class="warn">${esc(e.message)}</span>`); }
  finally { c.busy = false; }
  again(150);
}

async function readPhoto(file) {
  status('<span class="spin"></span> Lecture de la photo…');
  try {
    const { prepare, readText } = await import('../ocr.js');
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('Image illisible')); i.src = URL.createObjectURL(file); });
    const W = img.naturalWidth, H = img.naturalHeight;
    // Zones essayées : bas de la carte (photo verticale), puis l'image entière
    const zones = [[0, H * 0.80, W, H * 0.20], [0, H * 0.70, W, H * 0.30], [0, 0, W, H]];
    for (const [x, y, w, h] of zones) {
      for (const invert of [false, true]) {
        const text = await readText(prepare(img, x, y, w, h, { width: Math.min(2000, Math.max(1200, w)), invert }));
        const p = parseScan(text);
        if (isUseful(p) || (st.setId && p.local)) { URL.revokeObjectURL(img.src); if (await handle(text, { typed: true })) return; }
      }
    }
    URL.revokeObjectURL(img.src);
    status('<span class="warn">Numéro introuvable sur la photo. Recadre sur le bas de la carte, ou tape-le.</span>');
  } catch (e) { status(`<span class="warn">${esc(e.message)}</span>`); }
}
