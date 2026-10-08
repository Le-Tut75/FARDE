// Photos des produits scellés : rapprochement des noms Cardmarket avec le catalogue TCGplayer (via TCGCSV),
// qui fournit une image pour chaque produit.

const STOP = new Set(['pokemon', 'the', 'tcg', 'of', 'a', 'and', 'with', 'version', 'international', 'english', 'en', 'set', 'pack', 'packs', 'card', 'cards', 'game', 'trading', 'sv', 'swsh', 'sm', 'xy', 'me']);

export function normName(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[’'`´]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Type de produit : deux produits de types différents ne sont jamais rapprochés. */
export function productType(name) {
  const t = ` ${normName(name)} `;
  if (/ pokemon center /.test(t) && / elite trainer box /.test(t)) return 'etb-pc';
  if (/ elite trainer box /.test(t)) return 'etb';
  if (/ ultra premium collection /.test(t)) return 'upc';
  if (/ premium collection /.test(t)) return 'premium';
  if (/ booster box /.test(t) || / display /.test(t)) return 'box';
  if (/ booster bundle /.test(t)) return 'bundle';
  if (/ build (and )?battle /.test(t)) return 'build';
  if (/ mini tin /.test(t)) return 'minitin';
  if (/ tin /.test(t)) return 'tin';
  if (/ (3|three) pack blister /.test(t) || / 3 pack /.test(t)) return 'blister3';
  if (/ (checklane|single pack|1 pack) blister /.test(t)) return 'blister1';
  if (/ blister /.test(t)) return 'blister';
  if (/ sleeved booster /.test(t)) return 'sleeved';
  if (/ booster pack /.test(t) || / booster$/.test(t.trim()) || / booster /.test(t)) return 'booster';
  if (/ (theme|battle|league battle|starter|deck) /.test(t)) return 'deck';
  if (/ collection /.test(t) || / box /.test(t)) return 'collection';
  return 'other';
}

const words = (s) => normName(s).split(' ').filter((w) => w && !STOP.has(w));
function dice(a, b) {
  if (!a.length || !b.length) return 0;
  const B = new Map(); b.forEach((w) => B.set(w, (B.get(w) || 0) + 1));
  let inter = 0;
  for (const w of a) { const n = B.get(w); if (n) { inter++; B.set(w, n - 1); } }
  return (2 * inter) / (a.length + b.length);
}

/** Les produits japonais, chinois, coréens… n'ont pas d'équivalent TCGplayer : pas de photo plutôt qu'une mauvaise. */
const FOREIGN = /\b(jp|japanese|korean|chinese|simplified|traditional|thai|indonesian|kr|cn)\b/i;

/**
 * Index des produits TCGplayer. products : [{ productId, name, imageUrl? }]
 */
export function buildIndex(products) {
  const byType = new Map();
  for (const p of products) {
    const type = productType(p.name);
    const entry = { id: p.productId, name: p.name, w: words(p.name), image: p.imageUrl || `https://tcgplayer-cdn.tcgplayer.com/product/${p.productId}_200w.jpg` };
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(entry);
  }
  return byType;
}

/** Photo pour un nom de produit Cardmarket, ou null si aucune correspondance sûre. */
export function findImage(index, cmName) {
  if (FOREIGN.test(cmName)) return null;
  // "151 10 Elite Trainer Box Case" -> on prend la photo du produit à l'unité
  const base = String(cmName).replace(/\b\d+\s+(?=.*\bcase\b)/i, '').replace(/\bcase\b/i, '').trim();
  const type = productType(base);
  if (type === 'other') return null;
  const w = words(base.replace(/\([^)]*cards?\)/gi, ''));
  const nums = (arr) => new Set(arr.filter((x) => /^\d+$/.test(x)));
  const cmNums = nums(w);
  const baseName = (n) => normName(String(n).replace(/\[[^\]]*\]|\([^)]*\)/g, ''));
  let best = null, second = null;
  for (const p of index.get(type) || []) {
    let s = dice(w, p.w);
    // "Base Set" ne doit pas devenir "Base Set 2", ni "151" un autre set
    const pNums = nums(p.w);
    if ([...pNums].some((n) => !cmNums.has(n)) || [...cmNums].some((n) => +n >= 10 && !pNums.has(n))) s -= 0.3;
    if (!best || s > best.s) { second = best; best = { s, p }; } else if (!second || s > second.s) second = { s, p };
  }
  if (!best || best.s < 0.72) return null;
  // Deux versions d'un même produit (ETB [Mega Lucario] / [Mega Gardevoir]) : la première convient
  const sameProduct = second && baseName(second.p.name) === baseName(best.p.name);
  if (second && best.s - second.s < 0.04 && !sameProduct) return null;
  return best.p.image;
}
