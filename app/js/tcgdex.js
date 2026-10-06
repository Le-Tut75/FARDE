// Client du catalogue TCGdex (gratuit, sans clé) avec cache local.
import { norm } from './match.js';

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
});

function slimCard(c) {
  return {
    id: c.id, localId: c.localId, name: c.name, image: c.image || null, rarity: c.rarity || null,
    illustrator: c.illustrator || null, variants: c.variants || null,
    set: c.set ? { id: c.set.id, name: c.set.name, total: c.set.cardCount?.official ?? c.set.cardCount?.total ?? null } : null,
    cm: c.pricing?.cardmarket || null, tcgplayer: c.pricing?.tcgplayer || null,
  };
}
/** Fiche complète d'une carte (prix inclus), cache 24 h. */
export function getCard(lang, id, { fresh = false } = {}) {
  const key = `card.${lang}.${id}`;
  if (fresh) mem.delete(key);
  return cached(key, fresh ? 0 : DAY, async () => { const c = await api(`/${lang}/cards/${encodeURIComponent(id)}`); return c ? slimCard(c) : null; });
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
    return (r?.cards || []).map((c) => ({ id: c.id, localId: c.localId, name: c.name, image: c.image || null }));
  }
  const p = new URLSearchParams();
  if (mode === 'num') p.set('localId', `eq:${q}`); else p.set('name', exact ? `eq:${q}` : q);
  const r = await cached(`search.${lang}.${p}`, DAY, () => api(`/${lang}/cards?${p}`), false);
  return (r || []).map((c) => ({ id: c.id, localId: c.localId, name: c.name, image: c.image || null }));
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
    return (r || []).map((c) => ({ id: c.id, localId: c.localId, name: c.name, image: c.image || null }));
  }, false);
}
