// Vitrine publique : la collection (ou une farde) d'un utilisateur, en lecture seule, via un lien secret.
import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { lineCalc, variantLabel, DEFAULT_COND } from './valuation.js';
import { esc, eur, cardImg, openDialog, $ } from './ui.js';

try { const t = localStorage.getItem('farde.theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch {}
const el = $('#vt');
const fail = (m) => { el.innerHTML = `<div class="empty">${esc(m)}</div>`; };
const st = { q: '', sort: 'value', set: '' };
let data, rows;

async function main() {
  const token = new URLSearchParams(location.search).get('t');
  if (!token) return fail('Lien incomplet : il manque la fin de l’adresse.');
  let base = ''; try { base = new URL(SUPABASE_URL).origin; } catch {}
  if (!base || !SUPABASE_ANON_KEY) return fail('Cette vitrine n’est pas encore configurée.');
  const sb = createClient(base, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: d, error } = await sb.rpc('showcase', { t: token });
  if (error) return fail('Vitrine indisponible pour le moment. Réessaie plus tard.');
  if (!d) return fail('Ce lien n’existe pas ou a été supprimé par son propriétaire.');
  data = d;
  const settings = { basis: d.basis || 'trend', cond: { ...DEFAULT_COND, ...(d.cond || {}) } };
  rows = (d.cards || []).map((c) => ({ c, v: d.show_values ? lineCalc(c, { cm: c.cm, variants: c.variants || [] }, settings) : null }));
  document.title = `${d.title} · Farde`;
  draw();
}

function draw() {
  const total = rows.reduce((a, x) => a + (x.v?.value || 0), 0), n = rows.reduce((a, x) => a + (x.c.qty || 1), 0);
  const sets = [...new Map(rows.map((x) => [x.c.set_name || '—', 1])).keys()].sort((a, b) => a.localeCompare(b, 'fr'));
  if (!$('#vtGrid')) {
    el.innerHTML = `<section class="view">
      <div class="vh"><div><h2>${esc(data.title)}</h2><p>${n.toLocaleString('fr-FR')} carte${n > 1 ? 's' : ''}${data.binder && data.title !== data.binder ? ' · farde ' + esc(data.binder) : ''}</p></div>
        ${data.show_values ? `<div class="worth" style="padding:16px 20px;gap:4px"><span class="lbl">Valeur estimée</span><b class="kpi" style="color:var(--hero-ink)">${eur(total)}</b></div>` : ''}</div>
      <div class="row panel" style="padding:14px">
        <div class="field" style="flex:2 1 200px"><label for="vtQ">Chercher</label><input id="vtQ" type="search" placeholder="Nom, numéro…"></div>
        <div class="field" style="flex:2 1 200px"><label for="vtSet">Série</label><select id="vtSet"><option value="">Toutes</option>${sets.map((s) => `<option>${esc(s)}</option>`).join('')}</select></div>
        <div class="field" style="flex:1 1 150px"><label for="vtSort">Tri</label><select id="vtSort">${data.show_values ? '<option value="value">Plus cotées</option>' : ''}<option value="set">Par série</option><option value="name">Par nom</option></select></div>
      </div>
      <div class="cards" id="vtGrid"></div>
      <p class="note" style="text-align:center">Cotes Cardmarket mises à jour chaque matin. Vitrine créée avec Farde.</p>
    </section>`;
    $('#vtQ').oninput = (e) => { st.q = e.target.value.toLowerCase(); grid(); };
    $('#vtSet').onchange = (e) => { st.set = e.target.value; grid(); };
    $('#vtSort').onchange = (e) => { st.sort = e.target.value; grid(); };
    if (!data.show_values) st.sort = 'set';
    $('#vtGrid').onclick = (e) => { const t = e.target.closest('[data-i]'); if (t) zoom(+t.dataset.i); };
  }
  grid();
}
let shown = [];
function grid() {
  shown = rows.filter((x) => (!st.q || `${x.c.name} ${x.c.local_id} ${x.c.set_name}`.toLowerCase().includes(st.q)) && (!st.set || (x.c.set_name || '—') === st.set));
  if (st.sort === 'value') shown.sort((a, b) => (b.v?.value || 0) - (a.v?.value || 0));
  else if (st.sort === 'name') shown.sort((a, b) => a.c.name.localeCompare(b.c.name, 'fr'));
  $('#vtGrid').innerHTML = shown.slice(0, 600).map((x, i) => `<button class="tile" data-i="${i}"><div class="img">${cardImg(x.c.image, x.c.name)}${x.c.qty > 1 ? `<span class="badge">×${x.c.qty}</span>` : ''}${x.c.grading_company ? `<span class="langtag">${esc(x.c.grading_company)} ${esc(x.c.grade || '')}</span>` : ''}</div>
    <div class="t1 ellip">${esc(x.c.name)}</div><div class="t2"><span class="ellip">${esc(x.c.set_name || '')} · ${esc(x.c.local_id || '')}</span>${x.v?.value != null ? `<b class="num">${eur(x.v.value)}</b>` : ''}</div></button>`).join('')
    || '<div class="empty" style="grid-column:1/-1">Aucune carte.</div>';
}
function zoom(i) {
  const x = shown[i]; if (!x) return;
  openDialog(`<div style="position:relative"><button class="btn sm close" data-close aria-label="Fermer">✕</button><div class="md"><div class="cimg">${cardImg(x.c.image, x.c.name, '', 'high')}</div>
    <div class="stack"><h3>${esc(x.c.name)}</h3><div class="muted">${esc(x.c.set_name || '')} · ${esc(x.c.local_id || '')}${x.c.set_total ? '/' + x.c.set_total : ''} · ${esc((x.c.lang || '').toUpperCase())}</div>
    <div class="prices"><div><span>Version</span><b style="font-size:14px">${esc(variantLabel(x.c.variant))}</b></div><div><span>État</span><b style="font-size:14px">${x.c.grading_company ? esc(`${x.c.grading_company} ${x.c.grade || ''}`) : esc(x.c.condition)}</b></div><div><span>Quantité</span><b>${x.c.qty}</b></div>${x.v?.unit != null ? `<div><span>Cote unitaire</span><b>${eur(x.v.unit)}</b></div>` : ''}</div></div></div></div>`);
}
main().catch((e) => fail(e.message));
