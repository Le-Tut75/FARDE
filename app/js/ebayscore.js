// Prix rendu en France et score d'une annonce eBay. Module partagé entre l'app et la veille (Node) : aucune dépendance.

// Pays de l'Union européenne : pas de douane ni de TVA à l'import en France
export const EU = new Set(['FR', 'DE', 'IT', 'ES', 'BE', 'NL', 'LU', 'AT', 'PT', 'IE', 'FI', 'SE', 'DK', 'PL', 'CZ', 'SK', 'SI', 'HR', 'HU', 'RO', 'BG', 'GR', 'CY', 'MT', 'EE', 'LV', 'LT']);
const MARKET_COUNTRY = { EBAY_FR: 'FR', EBAY_DE: 'DE', EBAY_IT: 'IT', EBAY_ES: 'ES', EBAY_GB: 'GB', EBAY_US: 'US' };

/**
 * Hypothèses (modifiables dans l'app) :
 * vat : TVA à l'import (%) ; duty : droits de douane (%) ; handling : frais de dédouanement du transporteur (€) ;
 * lowValue : en dessous de ce montant (€), eBay encaisse la TVA à l'achat (guichet IOSS), sans droits ni frais de dédouanement.
 */
export const DEFAULT_PREFS = { vat: 20, duty: 2.7, handling: 15, lowValue: 150 };
const r2 = (v) => Math.round(v * 100) / 100;

export const countryOf = (it) => (it.country || MARKET_COUNTRY[it.market] || '').toUpperCase() || null;
export const isAuction = (it) => (it.buying || []).includes('AUCTION');

/** Prix rendu chez toi, en euros, avec le détail. */
export function landed(it, prefs = DEFAULT_PREFS) {
  const p = { ...DEFAULT_PREFS, ...(prefs || {}) };
  const base = Number(isAuction(it) ? (it.bid_eur ?? it.price_eur) : it.price_eur);
  if (!(base > 0)) return null;
  const shipKnown = it.ship_eur != null;
  const ship = shipKnown ? Number(it.ship_eur) : 0;
  const country = countryOf(it);
  const eu = !country || EU.has(country);
  let vat = 0, duty = 0, handling = 0, mode = 'ue';
  if (!eu) {
    const value = base + ship;
    if (value <= p.lowValue) { vat = (value * p.vat) / 100; mode = 'ioss'; }
    else { duty = (value * p.duty) / 100; vat = ((value + duty) * p.vat) / 100; handling = Number(p.handling) || 0; mode = 'douane'; }
  }
  return { base: r2(base), ship: r2(ship), shipKnown, vat: r2(vat), duty: r2(duty), handling: r2(handling), total: r2(base + ship + vat + duty + handling), eu, country, mode };
}

// Gradation lue dans le titre
const COMPANIES = [['PSA', /\bpsa\b/i], ['BGS', /\b(bgs|beckett)\b/i], ['CGC', /\bcgc\b/i], ['SGC', /\bsgc\b/i], ['PCA', /\bpca\b/i], ['Collect Aura', /\bcollect\s*aura\b|\bca\s*\d/i], ['ACE', /\bace\b/i], ['TAG', /\btag\b/i]];
export function parseGrade(title) {
  const t = String(title || '');
  const c = COMPANIES.find(([, re]) => re.test(t));
  if (!c) return null;
  const m = t.match(new RegExp(`${c[1].source}\\s*[-:#]?\\s*(?:gem\\s*mint\\s*|mint\\s*|nm-?mt\\s*)?(10|9\\.5|9|8\\.5|8|7\\.5|7|6\\.5|6|5\\.5|5|4|3|2|1\\.5|1)\\b`, 'i'));
  return { company: c[0], grade: m ? m[m.length - 1] : null };
}

const RED = /\b(proxy|fake|faux|r[ée]plique|replica|custom|orica|repro|reprint|fan\s*made|slab\s*(only|vide|seul)|empty\s*(slab|case)|case\s*only|[ée]tui\s*(seul|vide)|bo[iî]tier\s*(seul|vide)|no\s*card|sans\s*carte|digital|code\s*card)\b/i;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };

/**
 * Score de 0 à 100 et ses raisons. peers : les autres annonces de la même recherche.
 * Vert ≥ 70 (à regarder en priorité), orange 45–69, rouge < 45 (prudence).
 */
export function scoreItem(it, peers = [], prefs = DEFAULT_PREFS) {
  const reasons = [];
  let s = 50;
  const L = landed(it, prefs);
  const g = parseGrade(it.title);
  // 1. Prix rendu comparé aux annonces comparables (même société et même note si possible)
  const comparable = (x) => x !== it && x.item_id !== it.item_id && !x.hidden;
  let pool = peers.filter(comparable);
  if (g?.grade) { const same = pool.filter((x) => { const h = parseGrade(x.title); return h?.company === g.company && h?.grade === g.grade; }); if (same.length >= 3) pool = same; }
  const ref = median(pool.map((x) => landed(x, prefs)?.total).filter((v) => v > 0));
  let gap = null;
  if (L && ref && pool.length >= 3) {
    gap = (L.total - ref) / ref * 100;
    const pts = Math.max(-30, Math.min(30, -gap * 0.9));
    s += pts;
    reasons.push({ d: Math.round(pts), t: gap <= 0 ? `${Math.round(-gap)} % sous la médiane des ${pool.length} annonces comparables` : `${Math.round(gap)} % au-dessus de la médiane des ${pool.length} annonces comparables` });
  } else reasons.push({ d: 0, t: 'Pas assez d’annonces comparables pour juger le prix' });
  // 2. Vendeur
  const pct = Number(it.seller_score), cnt = Number(it.feedback_count);
  if (pct) {
    const d = pct >= 99.5 ? 10 : pct >= 98.5 ? 4 : pct >= 97 ? -8 : -20;
    s += d; reasons.push({ d, t: `Vendeur à ${String(pct).replace('.', ',')} % d’avis positifs` });
  }
  if (it.feedback_count != null) {
    const d = cnt >= 500 ? 5 : cnt >= 50 ? 2 : cnt < 10 ? -15 : -5;
    s += d; reasons.push({ d, t: cnt < 10 ? `Vendeur récent (${cnt} évaluations)` : `${cnt} évaluations` });
  }
  // 3. Pays (douane, délais, retours)
  if (L) {
    const d = L.eu ? 5 : L.mode === 'douane' ? -8 : -3;
    s += d; reasons.push({ d, t: L.eu ? `Expédiée depuis l’UE (${L.country || '?'}) : pas de douane` : `Hors UE (${L.country}) : ${L.mode === 'douane' ? 'douane, TVA et délais' : 'TVA à l’achat'}` });
    if (!L.shipKnown) { s -= 3; reasons.push({ d: -3, t: 'Frais de port non indiqués' }); }
  }
  // 4. Société de gradation (revente plus facile pour PSA, BGS, CGC)
  if (g) {
    const d = ['PSA', 'BGS', 'CGC'].includes(g.company) ? 5 : ['PCA', 'Collect Aura', 'SGC'].includes(g.company) ? 0 : -5;
    s += d; reasons.push({ d, t: `${g.company}${g.grade ? ' ' + g.grade : ''}${d > 0 ? ' : très recherchée à la revente' : d < 0 ? ' : moins recherchée à la revente' : ''}` });
  } else { s -= 5; reasons.push({ d: -5, t: 'Note de gradation introuvable dans le titre' }); }
  // 5. Photos et signaux d'alerte
  if (it.photos != null && it.photos < 3) { s -= 6; reasons.push({ d: -6, t: `Seulement ${it.photos} photo${it.photos > 1 ? 's' : ''}` }); }
  const red = RED.test(it.title || '');
  if (red) { s -= 45; reasons.push({ d: -45, t: 'Mot suspect dans le titre (proxy, réplique, boîtier seul…) : prudence quel que soit le prix' }); }
  const score = Math.max(0, Math.min(red ? 25 : 100, Math.round(s)));
  return { score, level: score >= 70 ? 'ok' : score >= 45 ? 'al' : 'err', reasons, ref: ref ? r2(ref) : null, gap, landed: L, grade: g };
}
