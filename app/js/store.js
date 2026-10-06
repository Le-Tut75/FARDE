// Données de l'utilisateur (Supabase) + cotes, avec copie locale pour le mode hors ligne.
import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { DEFAULT_SETTINGS, DEFAULT_COND, cardKey, portfolio, lineCalc, sealedCalc, parisDay, cmPrice } from './valuation.js';
import { getCard } from './tcgdex.js';
import { pool } from './ui.js';

export const configured = !!(SUPABASE_URL && SUPABASE_ANON_KEY && /^https?:\/\//.test(SUPABASE_URL));
export const sb = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'farde.auth' } })
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
export const calcLine = (l) => lineCalc(l, cmOf(l.lang, l.card_id), S.settings);
export const calcSealed = (s) => sealedCalc(s, s.cm_id != null ? S.sealedPrices.get(Number(s.cm_id)) : null);
export function totals() {
  const priceMap = new Map();
  for (const c of S.cards) priceMap.set(cardKey(c.lang, c.card_id), cmOf(c.lang, c.card_id));
  const t = portfolio(S.cards, S.sealed, priceMap, S.sealedPrices, S.settings);
  t.alerts = S.wish.filter((w) => w.target_price != null && wishPrice(w) != null && wishPrice(w) <= Number(w.target_price)).length;
  return t;
}
export const wishPrice = (w) => cmPrice(cmOf(w.lang, w.card_id), S.settings.basis, w.variant);
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
export async function searchSealed(words, limit = 40) {
  let q = sb.from('cm_sealed').select('*');
  for (const w of words) q = q.ilike('name', `%${w.replace(/[%_]/g, '')}%`);
  const rows = must(await q.order('trend', { ascending: false, nullsFirst: false }).limit(150), 'Recherche des scellés');
  // Pertinence : le produit le plus proche de la recherche d'abord (les cartons « Case » après)
  const wantsCase = words.some((w) => /^case$/i.test(w));
  const extra = (r) => r.name.split(/\s+/).length - words.length;
  return rows.map((r) => ({ r, s: (!wantsCase && /\bcase\b/i.test(r.name) ? 100 : 0) + extra(r) + (r.trend == null ? 5 : 0) }))
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
