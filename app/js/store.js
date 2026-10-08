// Données de l'utilisateur (Supabase) + cotes, avec copie locale pour le mode hors ligne.
import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { DEFAULT_SETTINGS, DEFAULT_COND, cardKey, portfolio, lineCalc, sealedCalc, parisDay, cmPrice, resolveCm } from './valuation.js';
import { getCard } from './tcgdex.js';
import { pool } from './ui.js';

// On ne garde que https://xxxx.supabase.co, même si l'adresse copiée contient /rest/v1 ou un / final
const BASE_URL = (() => { try { return new URL(SUPABASE_URL).origin; } catch { return ''; } })();
export const configured = !!(BASE_URL && SUPABASE_ANON_KEY);
export const sb = configured
  ? createClient(BASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'farde.auth' } })
  : null;

export const S = {
  user: null,
  settings: { ...DEFAULT_SETTINGS },
  cards: [], sealed: [], wish: [], binders: [],
  prices: new Map(),       // "lang:card_id" -> ligne card_prices (tâche quotidienne)
  live: new Map(),         // "lang:card_id" -> carte TCGdex récupérée en direct
  sealedPrices: new Map(), // cm_id -> ligne cm_sealed
  history: [],             // historique du portefeuille
  lastJob: null,
  loadedAt: 0,
  offline: false,
};

// ---- Abonnements au changement d'état ----
const listeners = new Set();
let emitTimer = null;
export const onChange = (f) => { listeners.add(f); return () => listeners.delete(f); };
export function emit() {
  clearTimeout(emitTimer);
  emitTimer = setTimeout(() => listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } }), 30);
}

class DbError extends Error {}
function must({ data, error }, what) {
  if (error) {
    const m = error.message || String(error);
    if (/JWT|token|session/i.test(m)) throw new DbError('Ta session a expiré : reconnecte-toi.');
    if (/fetch|network|Failed/i.test(m)) throw new DbError('Connexion à la base impossible. Vérifie ta connexion internet.');
    throw new DbError(`${what} : ${m}`);
  }
  return data;
}

async function fetchAll(table, build = (q) => q) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const data = must(await build(sb.from(table).select('*')).range(from, from + 999), `Lecture ${table}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

// ---- Copie locale (lecture hors ligne) ----
const snapKey = () => `farde.snap.${S.user?.id}`;
function saveSnapshot() {
  try {
    localStorage.setItem(snapKey(), JSON.stringify({
      savedAt: Date.now(), settings: S.settings, cards: S.cards, sealed: S.sealed, wish: S.wish, binders: S.binders,
      prices: [...S.prices.values()], sealedPrices: [...S.sealedPrices.values()], history: S.history, lastJob: S.lastJob,
    }));
  } catch { /* stockage plein : pas de copie hors ligne */ }
}
function loadSnapshot() {
  try {
    const s = JSON.parse(localStorage.getItem(snapKey()) || 'null');
    if (!s) return false;
    Object.assign(S, { settings: s.settings, cards: s.cards, sealed: s.sealed, wish: s.wish, binders: s.binders, history: s.history, lastJob: s.lastJob });
    S.prices = new Map(s.prices.map((r) => [cardKey(r.lang, r.card_id), r]));
    S.sealedPrices = new Map(s.sealedPrices.map((r) => [Number(r.id), r]));
    S.loadedAt = s.savedAt;
    return true;
  } catch { return false; }
}

// ---- Chargement complet ----
export async function loadAll() {
  try {
    const [settings, cards, sealed, wish, binders, history, job] = await Promise.all([
      sb.from('user_settings').select('*').maybeSingle().then((r) => must(r, 'Réglages')),
      fetchAll('collection', (q) => q.order('created_at', { ascending: true })),
      fetchAll('sealed', (q) => q.order('created_at', { ascending: true })),
      fetchAll('wishlist', (q) => q.order('created_at', { ascending: true })),
      fetchAll('binders', (q) => q.order('position').order('created_at')),
      fetchAll('portfolio_history', (q) => q.order('d')),
      sb.from('job_runs').select('*').order('id', { ascending: false }).limit(1).then((r) => must(r, 'Journal')),
    ]);
    S.settings = { ...DEFAULT_SETTINGS, ...(settings || {}), cond: { ...DEFAULT_COND, ...(settings?.cond || {}) } };
    if (!settings) await sb.from('user_settings').upsert({ user_id: S.user.id }).then(() => {});
    Object.assign(S, { cards, sealed, wish, binders, history, lastJob: job?.[0] || null });
    if (!binders.length) {
      const b = must(await sb.from('binders').insert({ name: 'Ma farde' }).select().single(), 'Création de la farde');
      S.binders = [b];
    }
    await loadPrices();
    S.offline = false;
    S.loadedAt = Date.now();
    saveSnapshot();
    emit();
    refreshLivePrices();
    return true;
  } catch (e) {
    if (loadSnapshot()) { S.offline = true; emit(); return false; }
    throw e;
  }
}

/** Cotes de la tâche quotidienne pour les cartes et scellés suivis. */
export async function loadPrices() {
  const ids = [...new Set([...S.cards, ...S.wish].map((c) => c.card_id))];
  const prices = new Map();
  for (let i = 0; i < ids.length; i += 120) {
    const data = must(await sb.from('card_prices').select('*').in('card_id', ids.slice(i, i + 120)), 'Lecture des cotes');
    for (const r of data) prices.set(cardKey(r.lang, r.card_id), r);
  }
  S.prices = prices;
  const cmIds = [...new Set(S.sealed.filter((s) => s.cm_id != null).map((s) => Number(s.cm_id)))];
  const sp = new Map();
  for (let i = 0; i < cmIds.length; i += 150) {
    const data = must(await sb.from('cm_sealed').select('*').in('id', cmIds.slice(i, i + 150)), 'Lecture des scellés');
    for (const r of data) sp.set(Number(r.id), r);
  }
  S.sealedPrices = sp;
}

/**
 * Cotes en direct (TCGdex) pour les cartes que la tâche quotidienne n'a pas encore traitées
 * (carte ajoutée aujourd'hui, ou tâche pas encore configurée).
 */
let liveRunning = false, liveAgain = false;
export async function refreshLivePrices() {
  if (S.offline) return;
  if (liveRunning) { liveAgain = true; return; }
  liveRunning = true; liveAgain = false;
  try {
    // Cartes ajoutées depuis le chargement : on récupère d'abord les cotes déjà en base
    const missing = [...new Set([...S.cards, ...S.wish].filter((c) => !S.prices.has(cardKey(c.lang, c.card_id))).map((c) => c.card_id))];
    for (let i = 0; i < missing.length; i += 120) {
      const { data } = await sb.from('card_prices').select('*').in('card_id', missing.slice(i, i + 120));
      for (const r of data || []) S.prices.set(cardKey(r.lang, r.card_id), r);
    }
    const stale = Date.now() - 3 * 864e5;
    const need = new Map();
    for (const c of [...S.cards, ...S.wish]) {
      const k = cardKey(c.lang, c.card_id);
      const p = S.prices.get(k);
      if (S.live.has(k)) continue;
      if (!p || !p.cm || new Date(p.updated_at).getTime() < stale) need.set(k, c);
    }
    if (!need.size) return;
    let n = 0;
    await pool([...need.values()], 4, async (c) => {
      const card = await getCard(c.lang, c.card_id);
      if (card) { S.live.set(cardKey(c.lang, c.card_id), card); if (++n % 10 === 0) emit(); }
    });
    emit();
  } finally {
    liveRunning = false;
    if (liveAgain) refreshLivePrices();
  }
}

// ---- Accès aux cotes ----
export function cmOf(lang, cardId) {
  const k = cardKey(lang, cardId);
  const p = S.prices.get(k);
  if (p?.cm && Date.now() - new Date(p.updated_at).getTime() < 3 * 864e5) return p.cm;
  return S.live.get(k)?.cm || p?.cm || null;
}
/** Cote de la carte + cotes de ses variantes (reverse Poké Ball…) quand la tâche du matin les connaît. */
export function priceOf(lang, cardId) {
  return { cm: cmOf(lang, cardId), variants: S.prices.get(cardKey(lang, cardId))?.variants || [] };
}
/** Charge la cote enregistrée d'une carte qui n'est pas encore dans la collection (fiche du catalogue). */
export async function ensurePriceRow(lang, cardId) {
  const k = cardKey(lang, cardId);
  if (S.prices.has(k) || S.offline) return;
  const { data } = await sb.from('card_prices').select('*').eq('lang', lang).eq('card_id', cardId).maybeSingle();
  if (data) S.prices.set(k, data);
}
export const calcLine = (l) => lineCalc(l, priceOf(l.lang, l.card_id), S.settings);
export const calcSealed = (s) => sealedCalc(s, s.cm_id != null ? S.sealedPrices.get(Number(s.cm_id)) : null);
export function totals() {
  const priceMap = new Map();
  for (const c of S.cards) priceMap.set(cardKey(c.lang, c.card_id), priceOf(c.lang, c.card_id));
  const t = portfolio(S.cards, S.sealed, priceMap, S.sealedPrices, S.settings);
  t.alerts = S.wish.filter((w) => w.target_price != null && wishPrice(w) != null && wishPrice(w) <= Number(w.target_price)).length;
  t.toCheck = S.cards.filter((l) => calcLine(l).toCheck).length;
  return t;
}
export const wishPrice = (w) => { const r = resolveCm(priceOf(w.lang, w.card_id), w.variant); return cmPrice(r.cm, S.settings.basis, r.variant); };
export const ownedQty = (lang, cardId) => S.cards.reduce((a, c) => a + (c.lang === lang && c.card_id === cardId ? c.qty : 0), 0);

/** Enregistre le point du jour dans l'historique (une fois les cotes connues). */
let lastSnap = null;
export async function snapshotToday() {
  if (S.offline || (!S.cards.length && !S.sealed.length)) return;
  const t = totals();
  const row = { user_id: S.user.id, d: parisDay(), value: t.value, invested: t.invested, cards_value: t.cardsValue, sealed_value: t.sealedValue };
  const sig = JSON.stringify(row);
  if (sig === lastSnap) return;
  lastSnap = sig;
  const { error } = await sb.from('portfolio_history').upsert(row, { onConflict: 'user_id,d' });
  if (!error) {
    const i = S.history.findIndex((h) => h.d === row.d);
    if (i >= 0) S.history[i] = row; else S.history.push(row);
  }
}

// ---- Écritures ----
function guard() { if (S.offline) throw new DbError('Hors ligne : modification impossible pour le moment.'); }

export async function addCard(row) {
  guard();
  const r = must(await sb.from('collection').insert(row).select().single(), "Ajout de la carte");
  S.cards.push(r); emit(); refreshLivePrices(); return r;
}
export async function updateCard(id, patch) {
  guard();
  const r = must(await sb.from('collection').update(patch).eq('id', id).select().single(), 'Modification');
  const i = S.cards.findIndex((c) => c.id === id); if (i >= 0) S.cards[i] = r; emit(); return r;
}
export async function deleteCards(ids) {
  guard();
  for (let i = 0; i < ids.length; i += 150) must(await sb.from('collection').delete().in('id', ids.slice(i, i + 150)), 'Suppression');
  const set = new Set(ids); S.cards = S.cards.filter((c) => !set.has(c.id)); emit();
}
export async function moveCards(ids, binderId) {
  guard();
  for (let i = 0; i < ids.length; i += 150) must(await sb.from('collection').update({ binder_id: binderId }).in('id', ids.slice(i, i + 150)), 'Déplacement');
  const set = new Set(ids); S.cards.forEach((c) => { if (set.has(c.id)) c.binder_id = binderId; }); emit();
}
/** Import en masse, par paquets de 200. */
export async function bulkInsertCards(rows, onProgress) {
  guard();
  const out = [];
  for (let i = 0; i < rows.length; i += 200) {
    const data = must(await sb.from('collection').insert(rows.slice(i, i + 200), { defaultToNull: false }).select(), 'Import');
    out.push(...data); S.cards.push(...data);
    onProgress?.(Math.min(i + 200, rows.length), rows.length);
  }
  emit(); refreshLivePrices(); return out;
}

export async function addSealed(row) {
  guard();
  const r = must(await sb.from('sealed').insert(row).select().single(), 'Ajout du scellé');
  S.sealed.push(r);
  if (r.cm_id != null && !S.sealedPrices.has(Number(r.cm_id))) {
    const p = must(await sb.from('cm_sealed').select('*').eq('id', r.cm_id).maybeSingle(), 'Cote du scellé');
    if (p) S.sealedPrices.set(Number(p.id), p);
  }
  emit(); return r;
}
export async function updateSealed(id, patch) {
  guard();
  const r = must(await sb.from('sealed').update(patch).eq('id', id).select().single(), 'Modification');
  const i = S.sealed.findIndex((c) => c.id === id); if (i >= 0) S.sealed[i] = r; emit(); return r;
}
export async function deleteSealed(id) {
  guard(); must(await sb.from('sealed').delete().eq('id', id), 'Suppression');
  S.sealed = S.sealed.filter((s) => s.id !== id); emit();
}

export async function addWish(row) {
  guard();
  const r = must(await sb.from('wishlist').upsert(row, { onConflict: 'user_id,lang,card_id,variant' }).select().single(), 'Wishlist');
  S.wish = S.wish.filter((w) => w.id !== r.id); S.wish.push(r); emit(); refreshLivePrices(); return r;
}
export async function updateWish(id, patch) {
  guard();
  const r = must(await sb.from('wishlist').update(patch).eq('id', id).select().single(), 'Wishlist');
  const i = S.wish.findIndex((c) => c.id === id); if (i >= 0) S.wish[i] = r; emit(); return r;
}
export async function deleteWish(id) {
  guard(); must(await sb.from('wishlist').delete().eq('id', id), 'Wishlist');
  S.wish = S.wish.filter((w) => w.id !== id); emit();
}

export async function addBinder(name, layout) {
  guard();
  const r = must(await sb.from('binders').insert({ name, layout, position: S.binders.length }).select().single(), 'Farde');
  S.binders.push(r); emit(); return r;
}
export async function updateBinder(id, patch) {
  guard();
  const r = must(await sb.from('binders').update(patch).eq('id', id).select().single(), 'Farde');
  const i = S.binders.findIndex((b) => b.id === id); if (i >= 0) S.binders[i] = r; emit(); return r;
}
export async function deleteBinder(id) {
  guard(); must(await sb.from('binders').delete().eq('id', id), 'Farde');
  S.binders = S.binders.filter((b) => b.id !== id);
  S.cards.forEach((c) => { if (c.binder_id === id) c.binder_id = null; }); emit();
}

export async function saveSettings(patch) {
  guard();
  const r = must(await sb.from('user_settings').upsert({ user_id: S.user.id, ...S.settings, ...patch }).select().single(), 'Réglages');
  S.settings = { ...DEFAULT_SETTINGS, ...r, cond: { ...DEFAULT_COND, ...(r.cond || {}) } }; emit(); return r;
}

/** Recherche dans le catalogue des scellés Cardmarket. */
/**
 * Recherche dans le catalogue des scellés Cardmarket.
 * words : mots à trouver dans le nom (anglais) ; cats : catégories Cardmarket ; like : motif supplémentaire
 */
export async function searchSealed({ words = [], cats = null, like = null, includeCases = false, limit = 60, order = null, withImage = false } = {}) {
  let q = sb.from('cm_sealed').select('*');
  if (withImage) q = q.not('image', 'is', null);
  for (const w of words) q = q.ilike('name', `%${w.replace(/[%_]/g, '')}%`);
  if (cats?.length) q = q.in('category_id', cats);
  if (like) q = q.ilike('name', like);
  const wantsCase = includeCases || words.some((w) => /^case$/i.test(w));
  if (!wantsCase) q = q.not('name', 'ilike', '%case%');
  order = order || (words.length ? 'relevance' : 'new');
  if (order === 'new') q = q.order('id', { ascending: false });            // identifiants croissants = produits récents
  else if (order === 'price_asc') q = q.order('trend', { ascending: true, nullsFirst: false });
  else q = q.order('trend', { ascending: false, nullsFirst: false });
  const rows = must(await q.limit(order === 'relevance' ? 300 : limit), 'Recherche des scellés');
  // Pertinence : le nom le plus proche de la recherche d'abord
  if (order !== 'relevance') return rows;
  const extra = (r) => r.name.split(/\s+/).length - words.length;
  return rows.map((r, i) => ({ r, s: extra(r) + (r.trend == null ? 5 : 0) + i / 1000 }))
    .sort((a, b) => a.s - b.s).slice(0, limit).map((x) => x.r);
}
export async function priceHistory(item) {
  return must(await sb.from('price_history').select('*').eq('item', item).order('d'), 'Historique');
}
export async function sealedCatalogSize() {
  const { count } = await sb.from('cm_sealed').select('id', { count: 'exact', head: true });
  return count || 0;
}

export async function deleteEverything() {
  guard();
  for (const t of ['collection', 'sealed', 'wishlist', 'portfolio_history', 'binders']) must(await sb.from(t).delete().eq('user_id', S.user.id), 'Suppression');
  await loadAll();
}
