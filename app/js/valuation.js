// Moteur de valorisation partagé entre l'app (navigateur) et la tâche quotidienne (Node).
// Aucune dépendance au navigateur : ne rien importer ici.

export const CONDITIONS = [
  ['NM', 'Near Mint'], ['EX', 'Excellent'], ['GD', 'Good'],
  ['LP', 'Light Played'], ['PL', 'Played'], ['PO', 'Poor'],
];
export const DEFAULT_COND = { NM: 1, EX: 0.85, GD: 0.7, LP: 0.55, PL: 0.4, PO: 0.25 };
export const VARIANTS = { normal: 'Normale', holo: 'Holo', reverse: 'Reverse', firstEdition: '1re édition' };
export const BASES = { trend: 'Prix tendance', avg30: 'Moyenne 30 jours', avg7: 'Moyenne 7 jours', avg1: 'Moyenne 24 h', low: 'Prix le plus bas', avg: 'Prix moyen de vente' };
export const DEFAULT_SETTINGS = { basis: 'trend', default_lang: 'fr', cond: { ...DEFAULT_COND }, telegram_chat_id: null };

const pos = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);

/**
 * Cote d'une carte selon la base choisie.
 * Sur Cardmarket, les champs "-holo" correspondent à la version brillante "reverse"
 * (pour une carte holo par nature, le prix normal EST celui de la holo).
 */
export function cmPrice(cm, basis = 'trend', variant = 'normal') {
  if (!cm) return null;
  const foil = variant === 'reverse';
  const pick = (b) => {
    const main = pos(cm[foil ? `${b}-holo` : b]);
    const alt = pos(cm[foil ? b : `${b}-holo`]);
    return main ?? alt;
  };
  return pick(basis) ?? pick('trend') ?? pick('avg30') ?? pick('avg') ?? pick('low');
}

/** Valeur d'une ligne de collection. */
export function lineCalc(line, cm, settings = DEFAULT_SETTINGS) {
  const qty = line.qty || 1;
  const invested = line.buy_price != null ? Number(line.buy_price) * qty : 0;
  let unit = null, source = 'none';
  if (line.manual_price != null && line.manual_price !== '') {
    unit = Number(line.manual_price); source = 'manuel';
  } else {
    const p = cmPrice(cm, settings.basis, line.variant);
    if (p != null) {
      if (line.grading_company) { unit = p; source = 'brut'; }  // cote non gradée : à remplacer par une cote manuelle
      else { unit = p * ((settings.cond || DEFAULT_COND)[line.condition] ?? 1); source = 'cote'; }
    }
  }
  const value = unit == null ? null : round2(unit * qty);
  const pl = value == null || line.buy_price == null ? null : round2(value - invested);
  return { unit: unit == null ? null : round2(unit), value, invested: round2(invested), pl, source };
}

/** Valeur d'un produit scellé. */
export function sealedCalc(s, cmRow) {
  const qty = s.qty || 1;
  const invested = s.buy_price != null ? Number(s.buy_price) * qty : 0;
  let unit = null, source = 'none';
  if (s.manual_price != null && s.manual_price !== '') { unit = Number(s.manual_price); source = 'manuel'; }
  else if (cmRow && pos(Number(cmRow.trend))) { unit = Number(cmRow.trend); source = 'cote'; }
  else if (cmRow && pos(Number(cmRow.avg30))) { unit = Number(cmRow.avg30); source = 'cote'; }
  const value = unit == null ? null : round2(unit * qty);
  const pl = value == null || s.buy_price == null ? null : round2(value - invested);
  return { unit, value, invested: round2(invested), pl, source };
}

export const cardKey = (lang, cardId) => `${lang}:${cardId}`;

/**
 * Totaux du portefeuille.
 * priceMap : Map("lang:card_id" -> objet cm), sealedMap : Map(cm_id -> ligne cm_sealed)
 */
export function portfolio(cards, sealed, priceMap, sealedMap, settings = DEFAULT_SETTINGS) {
  let cardsValue = 0, cardsInvested = 0, count = 0, unpriced = 0;
  for (const l of cards) {
    const c = lineCalc(l, priceMap.get(cardKey(l.lang, l.card_id)), settings);
    cardsValue += c.value || 0; cardsInvested += c.invested; count += l.qty || 1;
    if (c.value == null) unpriced++;
  }
  let sealedValue = 0, sealedInvested = 0;
  for (const s of sealed) {
    const c = sealedCalc(s, s.cm_id != null ? sealedMap.get(Number(s.cm_id)) : null);
    sealedValue += c.value || 0; sealedInvested += c.invested;
  }
  const value = round2(cardsValue + sealedValue), invested = round2(cardsInvested + sealedInvested);
  return {
    value, invested, pl: round2(value - invested), pct: invested ? ((value - invested) / invested) * 100 : null,
    cardsValue: round2(cardsValue), sealedValue: round2(sealedValue), count, unpriced,
  };
}

export function round2(v) { return Math.round(v * 100) / 100; }

/** Date du jour à Paris, format AAAA-MM-JJ. */
export function parisDay(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);
}
