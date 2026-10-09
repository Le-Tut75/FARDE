// Import d'un tableau de produits scellés (Excel, Google Sheets, CSV), rapprochés du catalogue Cardmarket.
import { S, searchSealed, bulkInsertSealed } from '../store.js';
import { parseDelimited } from './import.js';
import { sealedQueryWords, sealedImg } from './sealed.js';
import { norm, similarity, parseLang, parsePrice, parseQty, parseDate } from '../match.js';
import { esc, eur, langOptions, LANGS, pool, toast, download, toCsv, $ } from '../ui.js';

const COLS = [
  { key: 'name', label: 'Nom du produit', req: true, syn: ['nom', 'produit', 'nom du produit', 'name', 'product', 'article', 'item', 'designation', 'libelle'] },
  { key: 'lang', label: 'Langue', syn: ['langue', 'lang', 'language', 'version'] },
  { key: 'qty', label: 'Quantité', syn: ['quantite', 'qte', 'qty', 'quantity', 'nombre', 'nb'] },
  { key: 'buy_price', label: "Prix d'achat unitaire", syn: ['prix d achat', 'prix achat', 'achat', 'prix', 'price', 'paye', 'cout', 'prix unitaire'] },
  { key: 'buy_date', label: "Date d'achat", syn: ['date d achat', 'date achat', 'date', 'achete le'] },
  { key: 'notes', label: 'Notes', syn: ['notes', 'note', 'commentaire', 'remarque'] },
];
let st = fresh(), root;
function fresh() { return { step: 'source', raw: [], hasHeader: true, map: {}, lang: null, rows: [], done: null }; }

export function sealedTemplate() {
  download('modele-scelles-farde.csv', toCsv(['Nom du produit', 'Langue', 'Quantité', "Prix d'achat", "Date d'achat", 'Notes'], [
    ['Display Flammes Fantasmagoriques', 'FR', '1', '159,90', '15/11/2025', 'Exemple à remplacer'],
    ['ETB 151', 'FR', '2', '54,99', '', ''],
    ['Coffret Dracaufeu ex Premium', 'EN', '1', '', '', ''],
  ]), 'text/csv;charset=utf-8');
}

export function render(el) {
  st.lang = st.lang || S.settings.default_lang || 'fr';
  el.innerHTML = `<section class="view">
    <div class="vh"><div><h2>Importer des produits scellés</h2><p>Une ligne par produit. Seul le nom est obligatoire ; chaque nom est rapproché du catalogue Cardmarket pour avoir la photo et la cote.</p></div>
      <button class="btn" id="zTpl">Télécharger le modèle CSV</button></div>
    <div id="zBody"></div>
  </section>`;
  root = el.firstElementChild;
  $('#zTpl', root).onclick = sealedTemplate;
  draw();
}
export function update() {}

function draw() {
  if (!root?.isConnected) return;
  ({ source: drawSource, map: drawMap, review: drawReview, done: drawDone })[st.step]();
}

function drawSource() {
  $('#zBody', root).innerHTML = `<div class="grid2">
    <label class="drop" for="zFile"><b>Glisse ton fichier ici</b><span class="muted small">ou clique pour le choisir · .xlsx, .xls, .ods, .csv</span><input type="file" id="zFile" accept=".csv,.tsv,.txt,.xlsx,.xls,.ods" hidden></label>
    <div class="panel stack"><h3>Copier-coller</h3><p class="note">Sélectionne tes cellules dans Google Sheets ou Excel (titres compris), copie et colle ici.</p>
      <textarea id="zPaste" rows="6" placeholder="Nom du produit	Quantité	Prix d'achat&#10;Display 151	1	180"></textarea>
      <div class="row end"><button class="btn pri" id="zGo">Utiliser ce texte</button></div></div>
  </div><p class="loss" id="zErr" role="alert"></p>`;
  const err = (m) => { $('#zErr', root).textContent = m; };
  $('#zFile', root).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      if (/\.(csv|tsv|txt)$/i.test(f.name)) setRaw(parseDelimited(await f.text()));
      else {
        const { read, utils } = await import('../vendor/xlsx.js');
        const wb = read(await f.arrayBuffer(), { type: 'array', cellDates: true });
        const sheets = wb.SheetNames.map((n) => utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }).filter((r) => r.some((c) => String(c).trim() !== '')));
        setRaw(sheets.reduce((a, b) => (b.length > a.length ? b : a), []));
      }
    } catch (x) { err(x.message); }
  };
  $('#zGo', root).onclick = () => { const t = $('#zPaste', root).value; if (!t.trim()) return err('Colle d’abord tes cellules.'); try { setRaw(parseDelimited(t)); } catch (x) { err(x.message); } };
}

function setRaw(rows) {
  if (!rows.length) throw new Error('Aucune ligne trouvée.');
  if (rows.length > 2001) throw new Error('Plus de 2 000 lignes : découpe ton fichier.');
  const w = Math.max(...rows.map((r) => r.length));
  st.raw = rows.map((r) => Array.from({ length: w }, (_, i) => r[i] ?? ''));
  const H = st.raw[0].map((h) => norm(h));
  const map = {};
  for (const c of COLS) { const i = H.findIndex((h, j) => !Object.values(map).includes(j) && (c.syn.includes(h) || c.syn.some((x) => x.length > 3 && h.includes(x)))); if (i >= 0) map[c.key] = i; }
  st.hasHeader = Object.keys(map).length > 0;
  if (map.name == null) map.name = 0;
  st.map = map; st.step = 'map'; draw();
}

function drawMap() {
  const w = st.raw[0].length, data = st.hasHeader ? st.raw.slice(1) : st.raw;
  const name = (i) => (st.hasHeader ? `${String.fromCharCode(65 + i)} · ${st.raw[0][i]}` : `Colonne ${String.fromCharCode(65 + i)}`);
  const opts = (sel, req) => (req ? '' : '<option value="">— aucune —</option>') + Array.from({ length: w }, (_, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(name(i))}</option>`).join('');
  $('#zBody', root).innerHTML = `<div class="panel stack"><h3>${data.length} ligne${data.length > 1 ? 's' : ''} · quelle colonne contient quoi ?</h3>
    <div class="mapgrid">${COLS.map((c) => `<div class="field"><label for="zm-${c.key}">${c.label}${c.req ? ' *' : ''}</label><select id="zm-${c.key}" data-c="${c.key}">${opts(st.map[c.key], c.req)}</select></div>`).join('')}
      <div class="field"><label for="zLang">Langue par défaut</label><select id="zLang">${langOptions(st.lang)}</select></div></div>
    <label class="row small" style="gap:6px"><input type="checkbox" id="zHdr" ${st.hasHeader ? 'checked' : ''}> La première ligne contient les titres</label>
    <div class="row end"><button class="btn" id="zBack">Retour</button><button class="btn pri" id="zMatch">Reconnaître les produits</button></div></div>`;
  $('#zHdr', root).onchange = (e) => { st.hasHeader = e.target.checked; drawMap(); };
  $('#zBack', root).onclick = () => { st = fresh(); draw(); };
  $('#zMatch', root).onclick = async (e) => {
    root.querySelectorAll('[data-c]').forEach((s) => { st.map[s.dataset.c] = s.value === '' ? null : +s.value; });
    st.lang = $('#zLang', root).value;
    e.target.disabled = true;
    await match((d, n) => { e.target.textContent = `Reconnaissance… ${d}/${n}`; });
    st.step = 'review'; draw();
  };
}

/** Rapproche chaque nom du catalogue : traduction FR -> EN, recherche, puis score de ressemblance. */
async function match(onProgress) {
  const data = st.hasHeader ? st.raw.slice(1) : st.raw;
  const get = (r, k) => (st.map[k] == null ? '' : r[st.map[k]]);
  st.rows = data.map((r) => ({
    raw: String(get(r, 'name') || '').trim(), lang: get(r, 'lang') ? parseLang(get(r, 'lang'), st.lang) : st.lang,
    qty: parseQty(get(r, 'qty') || 1), buy_price: parsePrice(get(r, 'buy_price')), buy_date: parseDate(get(r, 'buy_date')), notes: String(get(r, 'notes') || '').trim() || null,
    cands: [], pick: -1, status: 'notfound', skip: false,
  })).filter((x) => x.raw);
  await pool(st.rows, 4, async (x) => {
    const words = await sealedQueryWords(x.raw);
    let c = await searchSealed({ words, limit: 8 }).catch(() => []);
    if (!c.length && words.length > 2) c = await searchSealed({ words: words.slice(0, words.length - 1), limit: 8 }).catch(() => []);
    const q = words.join(' ');
    const scored = c.map((p) => ({ p, s: similarity(q, p.name) })).sort((a, b) => b.s - a.s).slice(0, 6);
    x.cands = scored.map((y) => y.p);
    if (scored.length) {
      x.pick = 0;
      x.status = scored[0].s >= 0.6 && (!scored[1] || scored[0].s - scored[1].s >= 0.06) ? 'ok' : 'verify';
    }
  }, onProgress);
}

function drawReview() {
  const n = (s) => st.rows.filter((x) => x.status === s && !x.skip).length;
  $('#zBody', root).innerHTML = `<div class="panel stack">
      <div class="row"><span class="pill ok">${n('ok')} reconnus</span><span class="pill al">${n('verify')} à vérifier</span><span class="pill">${n('notfound')} hors catalogue</span></div>
      <p class="note">Vérifie les lignes orange : choisis le bon produit dans la liste. Un produit « hors catalogue » est ajouté avec son nom, sans cote automatique (tu pourras saisir une cote manuelle).</p></div>
    <div class="tw" id="zList">${st.rows.map((x, i) => {
      const p = x.cands[x.pick];
      return `<div class="ir-row ${x.skip ? 'muted' : ''}" data-i="${i}">
        ${sealedImg(p?.image, p?.name || x.raw, 'sthumb')}
        <div class="ir-src"><b>${esc(x.raw)}</b><div class="sub">${esc(LANGS[x.lang] || x.lang)} · ×${x.qty}${x.buy_price != null ? ' · ' + eur(x.buy_price) : ''}</div></div>
        <div style="min-width:0"><select data-pick="${i}" aria-label="Produit">${x.cands.map((c, k) => `<option value="${k}" ${k === x.pick ? 'selected' : ''}>${esc(c.name)} · ${c.trend != null ? eur(c.trend) : 'sans cote'}</option>`).join('')}<option value="-1" ${x.pick < 0 ? 'selected' : ''}>Hors catalogue : « ${esc(x.raw)} »</option></select></div>
        <div class="row ir-act"><span class="pill ${x.skip ? '' : x.status === 'ok' ? 'ok' : x.status === 'verify' ? 'al' : ''}">${x.skip ? 'ignoré' : x.status === 'ok' ? 'reconnu' : x.status === 'verify' ? 'à vérifier' : 'hors catalogue'}</span><button class="btn sm" data-skip="${i}">${x.skip ? 'Réintégrer' : 'Ignorer'}</button></div>
      </div>`;
    }).join('')}</div>
    <div class="bulk"><b>${st.rows.filter((x) => !x.skip).length} produits à importer</b><button class="btn sm" id="zRestart">Recommencer</button><button class="btn sm" id="zGo2" style="background:var(--surface);color:var(--ink)">Importer dans ma collection</button></div>`;
  const list = $('#zList', root);
  list.onchange = (e) => { const s = e.target.closest('[data-pick]'); if (!s) return; const x = st.rows[+s.dataset.pick]; x.pick = +s.value; x.status = x.pick < 0 ? 'notfound' : 'ok'; drawReview(); };
  list.onclick = (e) => { const b = e.target.closest('[data-skip]'); if (!b) return; const x = st.rows[+b.dataset.skip]; x.skip = !x.skip; drawReview(); };
  $('#zRestart', root).onclick = () => { st = fresh(); draw(); };
  $('#zGo2', root).onclick = async (e) => {
    e.target.disabled = true;
    const rows = st.rows.filter((x) => !x.skip).map((x) => {
      const p = x.cands[x.pick];
      return { cm_id: p ? p.id : null, name: p ? p.name : x.raw, category: p?.category || null, lang: x.lang, qty: x.qty, buy_price: x.buy_price, buy_date: x.buy_date,
        manual_price: null, notes: x.notes, url: null, image_url: null };
    });
    try { await bulkInsertSealed(rows, (d, n) => { e.target.textContent = `Import… ${d}/${n}`; }); st.done = rows.length; st.step = 'done'; draw(); }
    catch (err) { toast(err.message, 6000); e.target.disabled = false; }
  };
}

function drawDone() {
  $('#zBody', root).innerHTML = `<div class="panel stack" style="align-items:flex-start"><h3>Import terminé</h3><p>${st.done} produit${st.done > 1 ? 's' : ''} ajouté${st.done > 1 ? 's' : ''} à ta collection.</p>
    <div class="row"><a class="btn pri" href="#scelles">Voir mes scellés</a><button class="btn" id="zAgain">Importer un autre tableau</button></div></div>`;
  $('#zAgain', root).onclick = () => { st = fresh(); draw(); };
}
