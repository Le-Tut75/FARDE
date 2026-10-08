// Lecture du bas d'une carte (« MEW FR 199/165 ») et recherche de la carte correspondante.
// Module pur (testable sous Node) : les accès au catalogue passent par l'objet `src`.
import { SET_CODES, normLocal } from './match.js';

// Confusions classiques de la lecture optique dans une zone de chiffres
const DIGIT = { O: '0', D: '0', Q: '0', U: '0', I: '1', L: '1', J: '1', T: '1', Z: '2', S: '5', B: '8', G: '6', A: '4' };
const toDigits = (s) => String(s).toUpperCase().replace(/[ODQUILJTZSBGA]/g, (c) => DIGIT[c]);
const LANG_TOKENS = { FR: 'fr', EN: 'en', DE: 'de', IT: 'it', ES: 'es', JP: 'ja' };
const PREFIXES = ['TG', 'GG', 'SV', 'RC', 'SWSH', 'SM', 'XY', 'BW', 'H'];

/**
 * Analyse le texte lu (ou tapé) : code de série, langue, numéro et total.
 * "MEW FR 199/165" -> { code:'MEW', setId:'sv03.5', lang:'fr', local:'199', total:165 }
 * "025/202" -> { local:'025', total:202 } ; "SVP EN 085" -> { code:'SVP', setId:'svp', local:'085' }
 */
export function parseScan(text) {
  // « 199|165 », « 199\165 » : la barre oblique est parfois lue de travers
  const raw = String(text || '').toUpperCase().replace(/(?<=\d)\s?[|\\](?=\s?\d{2,3}\b)/g, '/').replace(/[^A-Z0-9/\s.-]/g, ' ');
  const out = { code: null, setId: null, lang: null, local: null, total: null, prefix: null };
  // Mots isolés : code de série officiel, langue
  const words = raw.split(/[\s/.-]+/).filter(Boolean);
  for (const w of words) {
    if (!out.setId && SET_CODES[w]) { out.code = w; out.setId = SET_CODES[w]; }
    if (!out.lang && LANG_TOKENS[w]) out.lang = LANG_TOKENS[w];
  }
  // Numéro avec préfixe de sous-série : TG05/TG30, GG12/GG70, SV045/SV122
  let m = raw.match(/\b(TG|GG|SV|RC)\s?([0-9OIL]{1,3})\s*\/\s*(?:TG|GG|SV|RC)?\s?([0-9OIL]{2,3})\b/);
  if (m) { out.prefix = m[1]; out.local = m[1] + toDigits(m[2]); out.total = null; return out; }
  // Numéro classique : 199/165 (les lettres prises pour des chiffres sont corrigées)
  const re = /([0-9ODQILZSBG]{1,3})\s*\/\s*([0-9ODQILZSBG]{2,3})(?![0-9])/g;
  const found = [];
  for (const x of raw.matchAll(re)) {
    const a = toDigits(x[1]), b = toDigits(x[2]);
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) continue;
    const digits = (x[1] + x[2]).replace(/[^0-9]/g, '').length;
    found.push({ local: a, total: parseInt(b, 10), digits });
  }
  found.sort((p, q) => q.digits - p.digits);
  const best = found.find((f) => f.total >= 10 && +f.local > 0 && +f.local <= Math.max(f.total * 3, f.total + 170));
  if (best) { out.local = best.local; out.total = best.total; return out; }
  // Barre oblique lue comme un 1 ou un 7 : « 1991165 » -> 199/165
  if (!found.length) {
    m = raw.match(/\b(\d{3})[17](\d{3})\b/) || raw.match(/\b(\d{2})[17](\d{2,3})\b/);
    if (m && +m[1] > 0 && +m[2] >= 10 && +m[1] <= +m[2] + 120) { out.local = m[1]; out.total = parseInt(m[2], 10); return out; }
  }
  // Promo ou numéro seul : « SVP 085 », « 085 »
  if (out.code) {
    const after = raw.slice(raw.indexOf(out.code) + out.code.length);
    m = after.match(/\b([0-9OIL]{1,3})\b/) || raw.match(/\b(\d{1,3})\b/);
    if (m) out.local = toDigits(m[1]);
    return out;
  }
  m = raw.trim().match(/^#?\s*([A-Z]{0,4}\d{1,3}[A-Z]?)$/);
  if (m) out.local = m[1];
  return out;
}

/** Le texte contient-il quelque chose d'exploitable ? */
export const isUseful = (p) => !!(p.local && (p.total || p.setId || p.prefix));

/**
 * Cherche la carte. src : { getSets(lang), getSet(lang, id) }
 * opts.lang : langue des cartes ; opts.lockSet : série imposée (mode ouverture)
 * Résultat : { status: 'ok'|'ambiguous'|'notfound', card, candidates, reason }
 */
export async function resolveScan(p, src, { lang = 'fr', lockSet = null } = {}) {
  if (!p.local) return { status: 'notfound', candidates: [], reason: 'Numéro illisible' };
  const L = normLocal(p.local);
  const sets = await src.getSets(lang);
  const byId = new Map(sets.map((s) => [s.id, s]));
  const pick = (c, s) => ({ id: c.id, localId: c.localId, name: c.name, image: c.image || null, setId: s.id, setName: s.name, setTotal: s.cardCount?.official ?? null, lang });
  const lookIn = async (s) => {
    const full = await src.getSet(lang, s.id).catch(() => null);
    const hit = full?.cards?.find((c) => normLocal(c.localId) === L);
    return hit ? pick(hit, s) : null;
  };
  // 1. Série imposée ou code lu sur la carte
  for (const id of [lockSet, p.setId]) {
    if (!id || !byId.has(id)) continue;
    const hit = await lookIn(byId.get(id));
    if (hit) return { status: 'ok', card: hit, candidates: [hit], reason: '' };
    if (id === lockSet && !p.total) return { status: 'notfound', candidates: [], reason: `Pas de n° ${p.local} dans « ${byId.get(id).name} »` };
  }
  // 2. Le total imprimé (« /165 ») désigne la série
  if (p.total) {
    const cands = sets.filter((s) => s.cardCount?.official === p.total);
    const hits = (await Promise.all(cands.slice(0, 10).map(lookIn))).filter(Boolean);
    if (hits.length === 1) return { status: 'ok', card: hits[0], candidates: hits, reason: '' };
    if (hits.length > 1) {
      // Plusieurs séries de même taille : la plus récente d'abord
      const order = new Map(sets.map((s, i) => [s.id, i]));
      hits.sort((a, b) => order.get(b.setId) - order.get(a.setId));
      return { status: 'ambiguous', card: null, candidates: hits, reason: `${hits.length} séries ont ${p.total} cartes` };
    }
    return { status: 'notfound', candidates: [], reason: `Aucune série de ${p.total} cartes ne contient le n° ${p.local}` };
  }
  return { status: 'notfound', candidates: [], reason: p.code ? `Série « ${p.code} » sans n° ${p.local}` : 'Lis aussi le total (ex. 199/165) ou choisis la série' };
}
