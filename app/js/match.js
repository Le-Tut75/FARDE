// Rapprochement d'une ligne de tableur avec le catalogue TCGdex.
// Module pur (testable sous Node) : les accès réseau passent par l'objet `src` fourni.

export function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`´]/g, ' ')
    .replace(/&/g, ' et ')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(s) {
  const t = ` ${s} `, out = new Map();
  for (let i = 0; i < t.length - 1; i++) { const b = t.slice(i, i + 2); out.set(b, (out.get(b) || 0) + 1); }
  return out;
}
/** Similarité de Dice (0 à 1) entre deux textes normalisés. */
export function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, total = 0;
  for (const [k, v] of A) { inter += Math.min(v, B.get(k) || 0); total += v; }
  for (const v of B.values()) total += v;
  return (2 * inter) / total;
}

/** "007" -> "7", "TG05" -> "TG5", "SWSH050" -> "SWSH50" */
export function normLocal(x) {
  const s = String(x ?? '').toUpperCase().replace(/[\s#°]|N°|NO\./g, '').replace(/^N(?=\d)/, '');
  const m = s.match(/^([A-Z-]*?)0*(\d+)([A-Z]*)$/);
  return m ? `${m[1].replace(/-$/, '')}${m[2]}${m[3]}` : s;
}

/** "199/165" -> {local:"199", total:165} ; "TG05/TG30" -> {local:"TG05", total:null} */
export function parseNumber(raw) {
  if (raw == null || raw === '') return { local: null, total: null };
  const s = String(raw).trim().replace(/^(n°|no\.?|#)\s*/i, '');
  const m = s.match(/^([A-Za-z]*-?\s?\d+[A-Za-z]*)\s*\/\s*([A-Za-z]*\d+)$/);
  if (m) {
    const total = /^\d+$/.test(m[2]) ? parseInt(m[2], 10) : null;
    return { local: m[1].replace(/\s/g, ''), total };
  }
  const n = typeof raw === 'number' ? String(Math.round(raw)) : s.replace(/\s/g, '');
  return { local: n || null, total: null };
}

const LANG_MAP = {
  fr: 'fr', fra: 'fr', francais: 'fr', french: 'fr', vf: 'fr',
  en: 'en', eng: 'en', anglais: 'en', english: 'en', us: 'en', uk: 'en', va: 'en',
  ja: 'ja', jp: 'ja', jap: 'ja', japonais: 'ja', japanese: 'ja', jpn: 'ja',
  de: 'de', ger: 'de', allemand: 'de', german: 'de', deutsch: 'de',
  it: 'it', ita: 'it', italien: 'it', italian: 'it', italiano: 'it',
  es: 'es', spa: 'es', espagnol: 'es', spanish: 'es', espanol: 'es',
};
export function parseLang(v, fallback = 'fr') {
  const k = norm(v).replace(/\s/g, '');
  return LANG_MAP[k] || fallback;
}

const COND_MAP = {
  mt: 'NM', mint: 'NM', m: 'NM', nm: 'NM', nearmint: 'NM', neuf: 'NM', parfait: 'NM',
  ex: 'EX', excellent: 'EX', tresbon: 'EX',
  gd: 'GD', good: 'GD', bon: 'GD', gdt: 'GD',
  lp: 'LP', lightplayed: 'LP', lightlyplayed: 'LP', legerementjoue: 'LP',
  pl: 'PL', played: 'PL', joue: 'PL', mp: 'PL',
  po: 'PO', poor: 'PO', abime: 'PO', hp: 'PO', damaged: 'PO',
};
export function parseCondition(v, fallback = 'NM') {
  const k = norm(v).replace(/\s/g, '').replace(/\(.*\)/, '');
  if (COND_MAP[k]) return COND_MAP[k];
  const m = String(v ?? '').match(/\b(MT|NM|EX|GD|LP|PL|PO)\b/i);
  return m ? COND_MAP[m[1].toLowerCase()] : fallback;
}

/** "12,50 €" -> 12.5 ; "1 234,56" -> 1234.56 ; "1,234.56" -> 1234.56 */
export function parsePrice(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;
  let s = String(v).replace(/[^\d.,-]/g, '');
  if (!s) return null;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc > -1) s = /,\d{3}$/.test(s) && s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function parseQty(v) {
  const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);
  return n >= 1 && n <= 9999 ? n : 1;
}

/** Accepte 15/03/2025, 15-03-25, 2025-03-15, un objet Date ou un numéro de série Excel. */
export function parseDate(v) {
  if (v == null || v === '') return null;
  const iso = (d) => (isNaN(d) ? null : d.toISOString().slice(0, 10));
  // Les dates Excel arrivent parfois quelques minutes avant minuit : on arrondit au jour le plus proche
  if (v instanceof Date) return iso(new Date(Math.round((v.getTime() - v.getTimezoneOffset() * 60000) / 864e5) * 864e5));
  if (typeof v === 'number' && v > 20000 && v < 80000) return iso(new Date(Date.UTC(1899, 11, 30) + v * 864e5));
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return iso(new Date(Date.UTC(y, +m[2] - 1, +m[1]))); }
  return null;
}

const GRADERS = ['PSA', 'CGC', 'BGS', 'PCA', 'Collect Aura', 'CA', 'SGC', 'ACE'];
export function parseGrading(text) {
  const m = String(text ?? '').match(/\b(PSA|CGC|BGS|PCA|SGC|ACE|Collect\s*Aura|CA)\s*[-:]?\s*(\d{1,2}(?:[.,]5)?)\b/i);
  if (!m) return null;
  let company = GRADERS.find((g) => g.toLowerCase() === m[1].toLowerCase().replace(/\s+/g, ' ')) || m[1].toUpperCase();
  if (company === 'CA') company = 'Collect Aura';
  return { company, grade: m[2].replace(',', '.') };
}

export function parseVariant(text) {
  const t = norm(text);
  const ball = t.match(/\b(poke ?ball|pokeball|master ?ball|masterball|love ?ball|dusk ?ball|sombre ball|quick ?ball|rapide ball|friend ?ball|copain ball)\b/);
  if (ball) {
    const b = ball[1].replace(/\s/g, '');
    const map = { pokeball: 'pokeball', masterball: 'masterball', loveball: 'loveball', duskball: 'duskball', sombreball: 'duskball', quickball: 'quickball', rapideball: 'quickball', friendball: 'friendball', copainball: 'friendball' };
    return `reverse:${map[b] || b}`;
  }
  if (/\b(1st|1ere|1re|premiere|first|ed1|edition 1|ed 1)\b/.test(t)) return /\bshadowless\b/.test(t) ? 'holo-shadowless+1st-edition' : 'firstEdition';
  if (/\bshadowless\b/.test(t)) return 'holo-shadowless';
  if (/\bcosmos\b/.test(t)) return 'holo:cosmos';
  if (/\b(reverse|rev|revers|reverse holo)\b/.test(t)) return 'reverse';
  if (/\b(holo|holographique|foil)\b/.test(t)) return 'holo';
  if (/\b(normal|normale|non holo|standard)\b/.test(t)) return 'normal';
  return null;
}

/** Retire du nom les mentions de variante, de gradation et de rareté. */
export function cleanName(raw) {
  let s = String(raw ?? '');
  const grading = parseGrading(s);
  const variant = parseVariant(s);
  s = s.replace(/\b(PSA|CGC|BGS|PCA|SGC|ACE|Collect\s*Aura)\s*[-:]?\s*\d{1,2}(?:[.,]5)?\b/gi, ' ')
    .replace(/\((?:[^)]*)\)|\[(?:[^\]]*)\]/g, ' ')
    .replace(/\b(reverse holo|reverse|rev|holo|foil|1st edition|1ere edition|1re edition|edition 1|ed1|shadowless|cosmos|pok[eé] ?ball|master ?ball|love ?ball|dusk ?ball|quick ?ball|friend ?ball|sar|sir|ar|ur|ir|chr|csr|fa|full art|alt art|secret|promo|gold|rainbow)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  return { name: s, variant, grading };
}

// --- Correspondance des colonnes ------------------------------------------------
export const FIELDS = [
  { key: 'name', label: 'Nom de la carte', syn: ['nom', 'name', 'carte', 'card', 'pokemon', 'nom de la carte', 'card name', 'produit', 'article'] },
  { key: 'number', label: 'Numéro', syn: ['numero', 'num', 'no', 'n', 'number', 'card number', 'n carte', 'code', 'numero de carte', 'nr'] },
  { key: 'set', label: 'Série / extension', syn: ['serie', 'set', 'extension', 'edition', 'expansion', 'bloc', 'set name', 'nom de la serie'] },
  { key: 'lang', label: 'Langue', syn: ['langue', 'lang', 'language', 'lg', 'version'] },
  { key: 'condition', label: 'État', syn: ['etat', 'condition', 'state', 'qualite', 'grade etat'] },
  { key: 'qty', label: 'Quantité', syn: ['quantite', 'qte', 'qty', 'quantity', 'nombre', 'nb', 'count', 'exemplaires', 'x'] },
  { key: 'buy_price', label: "Prix d'achat unitaire", syn: ['prix d achat', 'prix achat', 'achat', 'prix', 'price', 'buy price', 'purchase price', 'cout', 'paye', 'prix paye', 'prix unitaire'] },
  { key: 'buy_date', label: "Date d'achat", syn: ['date d achat', 'date achat', 'date', 'purchase date', 'achete le'] },
  { key: 'variant', label: 'Variante', syn: ['variante', 'variant', 'finition', 'finish', 'type', 'holo', 'reverse'] },
  { key: 'grading', label: 'Gradation', syn: ['gradation', 'grading', 'grade', 'note', 'psa', 'graded', 'gradee'] },
  { key: 'manual_price', label: 'Cote manuelle', syn: ['cote manuelle', 'manual price'] },
  { key: 'card_id', label: 'ID TCGdex', syn: ['id tcgdex', 'tcgdex', 'tcgdex id', 'card id'] },
  { key: 'notes', label: 'Notes', syn: ['notes', 'note perso', 'commentaire', 'comment', 'remarque', 'commentaires'] },
];

export function autoMap(headers) {
  const map = {}, used = new Set();
  const H = headers.map((h) => norm(h));
  for (const f of FIELDS) {
    let best = -1, bestScore = 0;
    H.forEach((h, i) => {
      if (used.has(i) || !h) return;
      let sc = 0;
      for (const syn of f.syn) {
        if (h === syn) sc = Math.max(sc, 1);
        else if (h.split(' ').includes(syn) && syn.length > 2) sc = Math.max(sc, 0.8);
        else if (syn.length > 3 && h.includes(syn)) sc = Math.max(sc, 0.7);
      }
      if (sc > bestScore) { bestScore = sc; best = i; }
    });
    if (best >= 0 && bestScore >= 0.7) { map[f.key] = best; used.add(best); }
  }
  return map;
}

/** Une ligne brute + correspondance de colonnes -> description normalisée */
export function rowToSpec(row, map, defaults = {}) {
  const get = (k) => (map[k] != null && map[k] >= 0 ? row[map[k]] : null);
  const rawName = get('name');
  const cn = cleanName(rawName);
  const { local, total } = parseNumber(get('number'));
  const gradingCol = get('grading');
  const grading = parseGrading(gradingCol) || cn.grading ||
    (gradingCol && /^\d{1,2}([.,]5)?$/.test(String(gradingCol).trim()) ? { company: 'PSA', grade: String(gradingCol).trim().replace(',', '.') } : null);
  return {
    rawName: rawName == null ? '' : String(rawName).trim(),
    name: cn.name,
    local, total,
    setText: get('set') == null ? '' : String(get('set')).trim(),
    lang: get('lang') != null && get('lang') !== '' ? parseLang(get('lang'), defaults.lang || 'fr') : (defaults.lang || 'fr'),
    condition: get('condition') != null && get('condition') !== '' ? parseCondition(get('condition'), defaults.condition || 'NM') : (defaults.condition || 'NM'),
    qty: parseQty(get('qty') ?? 1),
    buyPrice: parsePrice(get('buy_price')),
    buyDate: parseDate(get('buy_date')),
    variant: parseVariant(get('variant')) || cn.variant || null,
    grading,
    manualPrice: parsePrice(get('manual_price')),
    notes: get('notes') == null ? null : String(get('notes')).trim() || null,
    cardId: get('card_id') ? String(get('card_id')).trim() : null,
  };
}

// --- Séries ---------------------------------------------------------------------
// Abréviations officielles (anglais) -> identifiants TCGdex
export const SET_CODES = {
  SVI: 'sv01', PAL: 'sv02', OBF: 'sv03', MEW: 'sv03.5', PAR: 'sv04', PAF: 'sv04.5', TEF: 'sv05', TWM: 'sv06',
  SFA: 'sv06.5', SCR: 'sv07', SSP: 'sv08', PRE: 'sv08.5', JTG: 'sv09', DRI: 'sv10', BLK: 'sv10.5b', WHT: 'sv10.5w',
  SVE: 'sve', SVP: 'svp', MEG: 'me01', PFL: 'me02', ASC: 'me02.5', POR: 'me03', CRI: 'me04', PBL: 'me05', MEE: 'mee', MEP: 'mep',
  BS: 'base1', BASE: 'base1',
  SSH: 'swsh1', RCL: 'swsh2', DAA: 'swsh3', CPA: 'swsh3.5', VIV: 'swsh4', SHF: 'swsh4.5', BST: 'swsh5', CRE: 'swsh6',
  EVS: 'swsh7', CEL: 'cel25', FST: 'swsh8', BRS: 'swsh9', ASR: 'swsh10', PGO: 'swsh10.5', LOR: 'swsh11', SIT: 'swsh12', CRZ: 'swsh12.5',
};
const SERIES_PREFIX = /^(pokemon |jcc |tcg )?(ecarlate et violet|scarlet et violet|scarlet violet|epee et bouclier|sword et shield|sword shield|soleil et lune|sun et moon|sun moon|mega evolution|mega evolucion|xy|noir et blanc|black et white|ev|sv|eb|swsh|sl|sm)\b\s*/;
const stripSeries = (s) => { const r = s.replace(SERIES_PREFIX, '').trim(); return r || s; };
const normId = (id) => String(id).toLowerCase().replace(/pt/g, '.').replace(/(\D)0+(\d)/g, '$1$2');

/**
 * Trouve la série correspondant au texte saisi.
 * sets : liste des séries dans la langue de la carte ; altSets : liste anglaise (mêmes identifiants)
 */
export function resolveSet(setText, total, sets, altSets = []) {
  const byId = new Map(sets.map((s) => [s.id, s]));
  const t = norm(setText);
  const out = [];
  if (t) {
    const code = SET_CODES[String(setText).trim().toUpperCase()];
    if (code && byId.has(code)) return { set: byId.get(code), score: 1, candidates: [byId.get(code)] };
    const tid = normId(String(setText).trim());
    const tStripped = stripSeries(t);
    const names = new Map();
    for (const s of sets) names.set(s.id, [s.name]);
    for (const s of altSets) if (names.has(s.id)) names.get(s.id).push(s.name);
    for (const s of sets) {
      let sc = normId(s.id) === tid ? 1 : 0;
      for (const n of names.get(s.id)) {
        const ns = norm(n), nss = stripSeries(ns);
        if (ns === t || nss === tStripped) sc = Math.max(sc, 1);
        sc = Math.max(sc, similarity(ns, t), similarity(nss, tStripped));
        const tt = tStripped.split(' '), nt = nss.split(' ');
        if (tt.length && tt.every((w) => nt.includes(w)) && tStripped.length >= 3) sc = Math.max(sc, 0.82 + 0.1 * (tt.length / nt.length));
      }
      if (total && s.cardCount?.official) sc += s.cardCount.official === total ? 0.15 : -0.1;
      if (sc > 0.35) out.push({ set: s, score: Math.min(sc, 1.2) });
    }
  } else if (total) {
    for (const s of sets) if (s.cardCount?.official === total) out.push({ set: s, score: 0.6 });
  }
  out.sort((a, b) => b.score - a.score);
  const best = out[0];
  const confident = best && best.score >= 0.75 && (!out[1] || best.score - out[1].score >= 0.05);
  return { set: confident ? best.set : null, score: best?.score || 0, candidates: out.slice(0, 8).map((x) => x.set) };
}

export const setIdOf = (cardId) => { const i = String(cardId).lastIndexOf('-'); return i > 0 ? cardId.slice(0, i) : null; };

/**
 * Rapproche une ligne avec une carte.
 * src : { getSets(lang), getSetsAlt(lang), getSet(lang, id) -> {cards:[]}, searchByName(lang, name) -> [] }
 * Résultat : { status: 'ok'|'verify'|'ambiguous'|'notfound', card, candidates, reason }
 */
export async function matchSpec(spec, src) {
  const lang = spec.lang;
  const sets = await src.getSets(lang);
  const setsById = new Map(sets.map((s) => [s.id, s]));
  const enrich = (c, set) => {
    const s = set || setsById.get(setIdOf(c.id));
    return { id: c.id, localId: c.localId, name: c.name, image: c.image || null, setId: s?.id || setIdOf(c.id), setName: s?.name || null, setTotal: s?.cardCount?.official ?? null };
  };
  const nameSim = (c) => (spec.name ? similarity(c.name, spec.name) : 1);
  const L = spec.local ? normLocal(spec.local) : null;

  // 0. Identifiant TCGdex connu (réimport d'un export Farde)
  if (spec.cardId && setIdOf(spec.cardId)) {
    const set = setsById.get(setIdOf(spec.cardId));
    const full = set ? await src.getSet(lang, set.id) : null;
    const hit = full?.cards?.find((c) => c.id === spec.cardId);
    if (hit) return { status: 'ok', card: enrich(hit, set), candidates: [enrich(hit, set)], reason: '' };
  }
  if (!spec.name && !spec.local) return { status: 'notfound', card: null, candidates: [], reason: 'Ligne vide' };

  // 1. Série identifiée
  let rs = { set: null, candidates: [] };
  if (spec.setText || spec.total) {
    const alt = spec.setText && src.getSetsAlt ? await src.getSetsAlt(lang) : [];
    rs = resolveSet(spec.setText, spec.total, sets, alt);
  }
  const trySet = async (set) => {
    const full = await src.getSet(lang, set.id);
    const cards = full?.cards || [];
    if (L) {
      const hit = cards.find((c) => normLocal(c.localId) === L);
      if (hit) return { hit: enrich(hit, set), sim: nameSim(hit) };
      return null;
    }
    const scored = cards.map((c) => ({ c, s: nameSim(c) })).filter((x) => x.s >= 0.75).sort((a, b) => b.s - a.s);
    if (scored.length) return { list: scored.map((x) => enrich(x.c, set)), top: scored[0].s, unique: scored.length === 1 || scored[0].s - scored[1].s > 0.15 };
    return null;
  };

  if (rs.set) {
    const r = await trySet(rs.set);
    if (r?.hit) {
      if (r.sim >= 0.5) return { status: 'ok', card: r.hit, candidates: [r.hit], reason: '' };
      return { status: 'verify', card: r.hit, candidates: [r.hit], reason: `Le n° ${spec.local} de « ${rs.set.name} » est « ${r.hit.name} »` };
    }
    if (r?.list) {
      if (r.unique && r.top >= 0.9) return { status: 'ok', card: r.list[0], candidates: r.list, reason: '' };
      return { status: 'ambiguous', card: null, candidates: r.list.slice(0, 24), reason: 'Plusieurs cartes portent ce nom dans la série' };
    }
  }

  // 2. Recherche par nom
  let found = [];
  if (spec.name) {
    found = (await src.searchByName(lang, spec.name)) || [];
    if (!found.length) {
      const first = norm(spec.name).split(' ').find((w) => w.length >= 4);
      if (first && first !== norm(spec.name)) found = (await src.searchByName(lang, first)) || [];
    }
  }
  let cands = found.map((c) => ({ c, s: nameSim(c) })).filter((x) => x.s >= 0.5);
  if (L) cands = cands.filter((x) => normLocal(x.c.localId) === L);
  if (spec.total) {
    const withTotal = cands.filter((x) => setsById.get(setIdOf(x.c.id))?.cardCount?.official === spec.total);
    if (withTotal.length) cands = withTotal;
  }
  if (rs.candidates.length && cands.length > 1) {
    const ids = new Set(rs.candidates.map((s) => s.id));
    const inSets = cands.filter((x) => ids.has(setIdOf(x.c.id)));
    if (inSets.length) cands = inSets;
  }
  cands.sort((a, b) => b.s - a.s);
  const list = cands.map((x) => enrich(x.c));

  if (list.length === 1 && (L || cands[0].s >= 0.95)) {
    if (rs.set && list[0].setId !== rs.set.id) {
      return { status: 'verify', card: list[0], candidates: list, reason: `Trouvée dans « ${list[0].setName} » et non dans « ${rs.set.name} »` };
    }
    return { status: L && cands[0].s >= 0.6 ? 'ok' : 'verify', card: list[0], candidates: list, reason: L ? '' : 'Seule carte portant ce nom' };
  }
  if (list.length > 1 && L && cands[0].s - cands[1].s > 0.2 && cands[0].s >= 0.85) {
    return { status: 'verify', card: list[0], candidates: list.slice(0, 24), reason: 'Correspondance probable' };
  }
  if (list.length) return { status: 'ambiguous', card: null, candidates: list.slice(0, 24), reason: `${list.length} cartes possibles` };

  // 3. Le numéro seul dans une série probable
  if (L && rs.candidates.length) {
    for (const s of rs.candidates.slice(0, 3)) {
      const r = await trySet(s);
      if (r?.hit) return { status: 'verify', card: r.hit, candidates: [r.hit], reason: `Trouvée par numéro dans « ${s.name} »` };
    }
  }
  const fallback = found.slice(0, 24).map((c) => enrich(c));
  if (fallback.length) return { status: 'ambiguous', card: null, candidates: fallback, reason: 'Aucune correspondance exacte' };
  return { status: 'notfound', card: null, candidates: [], reason: spec.setText && !rs.set ? `Série « ${spec.setText} » non reconnue` : 'Carte introuvable dans le catalogue' };
}
