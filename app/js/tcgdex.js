// Client du catalogue TCGdex (gratuit, sans clé) avec cache local.
import { norm } from './match.js';
import { variantKey } from './valuation.js';

export const API = 'https://api.tcgdex.net/v2';
const DAY = 864e5;
const mem = new Map();

// ---- Cache navigateur (tolérant aux erreurs et au manque de place) ----
const PREFIX = 'farde.tcg.';
function lsGet(key, ttl) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    return Date.now() - t < ttl ? v : null;
  } catch { return null; }
}
function lsSet(key, v) {
  const data = JSON.stringify({ t: Date.now(), v });
  try { localStorage.setItem(PREFIX + key, data); }
  catch {
    // Plus de place : on supprime la moitié la plus ancienne du cache catalogue
    try {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX))
        .map((k) => { try { return [k, JSON.parse(localStorage.getItem(k)).t]; } catch { return [k, 0]; } })
        .sort((a, b) => a[1] - b[1]);
      keys.slice(0, Math.ceil(keys.length / 2)).forEach(([k]) => localStorage.removeItem(k));
      localStorage.setItem(PREFIX + key, data);
    } catch { /* tant pis : cache en mémoire seulement */ }
  }
}
export function clearCatalogCache() {
  mem.clear();
  try { Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k)); } catch {}
}

async function api(path, { tries = 2, timeout = 15000 } = {}) {
  let last;
  for (let i = 0; i <= tries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(API + path, { signal: ctrl.signal });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Le catalogue TCGdex a répondu ${r.status}`);
      return await r.json();
    } catch (e) {
      last = e.name === 'AbortError' ? new Error('Le catalogue TCGdex ne répond pas') : e;
      if (i < tries) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    } finally { clearTimeout(t); }
  }
  throw last;
}

/** Mise en cache mémoire + navigateur, avec partage des requêtes en cours. */
function cached(key, ttl, loader, persist = true) {
  if (mem.has(key)) return mem.get(key);
  const hit = persist ? lsGet(key, ttl) : null;
  if (hit != null) { const p = Promise.resolve(hit); mem.set(key, p); return p; }
  const p = loader().then((v) => { if (v != null && persist) lsSet(key, v); return v; });
  p.catch(() => mem.delete(key));
  mem.set(key, p);
  return p;
}

// ---- Images de repli ----
// TCGdex n'a pas toujours l'image d'une carte dans chaque langue (séries récentes, promos).
// Les identifiants étant communs, on reprend alors l'image anglaise : assets.tcgdex.net/en/<bloc>/<série>/<numéro>
let serieOf = null, serieP = null;
export function loadSerieMap() {
  if (!serieP) {
    serieP = getSeriesGroups('en').then((groups) => {
      const m = new Map();
      for (const g of groups) if (!g.id.startsWith('_')) for (const st of g.sets) m.set(st.id, g.id);
      serieOf = m; return m;
    }).catch(() => { serieP = null; return new Map(); });
  }
  return serieP;
}
/** Image d'une carte, ou celle de sa version anglaise si la langue n'en a pas. */
export function imageOf(cardId, localId, image) {
  if (image) return image;
  const i = String(cardId || '').lastIndexOf('-');
  const setId = i > 0 ? cardId.slice(0, i) : null;
  const serie = setId && serieOf?.get(setId);
  const lid = localId ?? (i > 0 ? cardId.slice(i + 1) : null);
  return serie && lid ? `https://assets.tcgdex.net/en/${serie}/${setId}/${lid}` : null;
}
const fillImages = async (cards) => {
  if (cards?.some((c) => !c.image)) { await loadSerieMap(); for (const c of cards) if (!c.image) c.image = imageOf(c.id, c.localId, null); }
  return cards;
};

/** Liste des séries, les plus récentes d'abord. */
export const getSets = (lang) => cached(`sets.${lang}`, 3 * DAY, async () => {
  const s = await api(`/${lang}/sets`);
  return (s || []).map((x) => ({ id: x.id, name: x.name, cardCount: x.cardCount || {}, logo: x.logo || null }));
}).then((s) => s || []);
export const getSetsNewestFirst = async (lang) => [...(await getSets(lang))].reverse();

/** Détail d'une série avec ses cartes. */
export const getSet = (lang, id) => cached(`set.${lang}.${id}`, 7 * DAY, async () => {
  const s = await api(`/${lang}/sets/${encodeURIComponent(id)}`);
  if (!s) return null;
  return {
    id: s.id, name: s.name, cardCount: s.cardCount || {}, releaseDate: s.releaseDate || null,
    cards: (s.cards || []).map((c) => ({ id: c.id, localId: c.localId, name: c.name, image: c.image || null })),
  };
}).then(async (s) => { if (s) await fillImages(s.cards); return s; });

function slimCard(c) {
  return {
    id: c.id, localId: c.localId, name: c.name, image: c.image || null, rarity: c.rarity || null,
    illustrator: c.illustrator || null, variants: c.variants || null,
    set: c.set ? { id: c.set.id, name: c.set.name, total: c.set.cardCount?.official ?? c.set.cardCount?.total ?? null } : null,
    cm: c.pricing?.cardmarket || null, tcgplayer: c.pricing?.tcgplayer || null,
    vd: Array.isArray(c.variants_detailed) ? c.variants_detailed.map((v) => ({ key: variantKey(v), cmId: v?.thirdParty?.cardmarket ?? null })) : null,
    // Identifiant TCGplayer : sert de photo de secours quand TCGdex n'a pas encore l'image (promos récentes)
    tcg: (c.variants_detailed || []).map((v) => v?.thirdParty?.tcgplayer).find(Boolean) ?? null,
  };
}
/** Fiche complète d'une carte (prix inclus), cache 24 h. */
export function getCard(lang, id, { fresh = false } = {}) {
  const key = `card.${lang}.${id}`;
  if (fresh) mem.delete(key);
  const load = () => cached(key, fresh ? 0 : DAY, async () => { const c = await api(`/${lang}/cards/${encodeURIComponent(id)}`); return c ? slimCard(c) : null; });
  // Fiche mise en cache avant la version 1.8 (sans identifiant TCGplayer) : on la recharge une fois
  return load().then((c) => { if (c && c.tcg === undefined && !fresh) { mem.delete(key); fresh = true; return load(); } return c; })
    .then(async (c) => { if (c && !c.image) { await loadSerieMap(); c.image = imageOf(c.id, c.localId, null); } return c; });
}

/** Recherche par nom (contient), par numéro ou par illustrateur. */
export async function searchCards(lang, { q, mode = 'name', exact = false, setId = null }) {
  if (setId) {
    const s = await getSet(lang, setId);
    let cards = s?.cards || [];
    const nq = norm(q);
    if (q) {
      if (mode === 'num') cards = cards.filter((c) => String(c.localId).replace(/^0+/, '').toLowerCase() === String(q).replace(/^0+/, '').toLowerCase());
      else if (mode === 'name') cards = cards.filter((c) => (exact ? norm(c.name) === nq : norm(c.name).includes(nq)));
    }
    return cards;
  }
  if (mode === 'illu') {
    const r = await cached(`illu.${lang}.${q.toLowerCase()}`, DAY, () => api(`/${lang}/illustrators/${encodeURIComponent(q)}`), false);
    return fillImages((r?.cards || []).map((c) => ({ id: c.id, localId: c.localId, name: c.name, image: c.image || null })));
  }
  const p = new URLSearchParams();
  if (mode === 'num') p.set('localId', `eq:${q}`); else p.set('name', exact ? `eq:${q}` : q);
  const r = await cached(`search.${lang}.${p}`, DAY, () => api(`/${lang}/cards?${p}`), false);
  return fillImages((r || []).map((c) => ({ id: c.id, localId: c.localId, name: c.name, image: c.image || null })));
}

/** Pour l'import : recherche large sur le mot le plus long du nom (gère "Dracaufeu ex" / "Dracaufeu-ex"). */
export function searchByName(lang, name) {
  // On garde les accents : le catalogue les distingue ("Évoli" ≠ "Evoli")
  const words = String(name ?? '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !/^\d+$/.test(w)).sort((a, b) => b.length - a.length);
  const w = (words[0] || String(name ?? '').trim()).toLowerCase();
  if (!w) return Promise.resolve([]);
  return cached(`byname.${lang}.${w}`, DAY, async () => {
    let r = await api(`/${lang}/cards?name=${encodeURIComponent(w)}`);
    // "Evoli" sans accent : on retente sans la première lettre puis on filtre sans accents
    if ((!r || !r.length) && w.length >= 5) {
      const r2 = await api(`/${lang}/cards?name=${encodeURIComponent(w.slice(1))}`);
      r = (r2 || []).filter((c) => norm(c.name).includes(norm(w)));
    }
    return fillImages((r || []).map((c) => ({ id: c.id, localId: c.localId, name: c.name, image: c.image || null })));
  }, false);
}

export const LANG_ORDER = ['fr', 'en', 'de', 'it', 'es', 'ja'];

/**
 * Séries regroupées par bloc (Méga-Évolution, Écarlate et Violet…), le plus récent d'abord.
 * Résultat : [{ id, name, sets: [{ id, name, cardCount }] }]
 */
// ---- Promos (Black Star Promos, promos Épée et Bouclier, McDonald's…) ----
/** Préfixe imprimé sur la carte -> série TCGdex (« SWSH050 », « SVP 085 »). */
export const PROMO_PREFIX = { SVP: 'svp', MEP: 'mep', SWSH: 'swshp', SM: 'smp', XY: 'xyp', BW: 'bwp', HGSS: 'hgssp', DP: 'dpp', NP: 'np' };
const PROMO_ID = /^(svp|mep|swshp|smp|xyp|bwp|hgssp|dpp|np|basep|wp)$|^mcd|^pop\d/i;
const promoIds = new Set();
/** La série est-elle une série de promos ? (identifiant connu, ou « promo » / « McDonald's » dans son nom) */
export const isPromoSet = (id, name = '') => PROMO_ID.test(id || '') || promoIds.has(id) || /promo|mcdonald/i.test(name || '');
/** Séries de promos d'une langue, les plus récentes d'abord. */
export async function promoSets(lang) {
  const sets = (await getSets(lang).catch(() => [])).filter((s) => isPromoSet(s.id, s.name));
  sets.forEach((s) => promoIds.add(s.id));
  return [...sets].reverse();
}
/** Ajoute un groupe « Promos » en tête de la liste des séries : toutes les promos au même endroit. */
function withPromos(groups) {
  const seen = new Set(), sets = [];
  for (const g of groups) for (const s of g.sets) if (!seen.has(s.id) && isPromoSet(s.id, s.name)) { seen.add(s.id); promoIds.add(s.id); sets.push(s); }
  return sets.length ? [{ id: '_promos', name: 'Promos (toutes séries)', sets }, ...groups] : groups;
}

export const getSeriesGroups = (lang) => rawGroups(lang).then(withPromos);
const rawGroups = (lang) => cached(`blocs.${lang}`, 3 * DAY, async () => {
  const [series, allSets] = await Promise.all([api(`/${lang}/series`), getSets(lang)]);
  const groups = [];
  const seen = new Set();
  const details = await Promise.all((series || []).map((s) => api(`/${lang}/series/${encodeURIComponent(s.id)}`).catch(() => null)));
  (series || []).forEach((s, i) => {
    const sets = (details[i]?.sets || []).map((x) => ({ id: x.id, name: x.name, cardCount: x.cardCount || {} })).reverse();
    sets.forEach((x) => seen.add(x.id));
    if (sets.length) groups.push({ id: s.id, name: s.name, sets });
  });
  groups.reverse();
  const rest = allSets.filter((x) => !seen.has(x.id)).reverse();
  if (rest.length) groups.push({ id: '_autres', name: 'Autres séries', sets: rest });
  return groups;
}).then((g) => g || []);

/** Blocs pour une langue, ou pour « toutes les langues » (blocs français, sinon anglais). */
export async function groupsFor(lang) {
  if (lang !== 'all') return getSeriesGroups(lang);
  const fr = await getSeriesGroups('fr').catch(() => []);
  return fr.length ? fr : getSeriesGroups('en');
}

/**
 * Recherche dans une langue ou dans toutes (lang = 'all').
 * Chaque résultat porte sa langue ; une même carte trouvée en plusieurs langues n'apparaît qu'une fois.
 */
export async function searchAny(lang, opts, preferred = 'fr') {
  if (lang !== 'all') return (await searchCards(lang, opts)).map((c) => ({ ...c, lang }));
  const order = [preferred, ...LANG_ORDER.filter((l) => l !== preferred)];
  if (opts.setId) {
    // Une série : on la prend dans la première langue où elle existe
    for (const l of order) {
      const r = await searchCards(l, opts).catch(() => null);
      if (r && (r.length || !opts.q)) { const s = await getSet(l, opts.setId).catch(() => null); if (s) return r.map((c) => ({ ...c, lang: l })); }
    }
    return [];
  }
  const all = await Promise.all(order.map((l) => searchCards(l, opts).then((r) => r.map((c) => ({ ...c, lang: l }))).catch(() => [])));
  const out = [], ids = new Set();
  for (const list of all) for (const c of list) if (!ids.has(c.id)) { ids.add(c.id); out.push(c); }
  return out;
}
