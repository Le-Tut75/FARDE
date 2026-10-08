// Opportunités : cartes dont la cote Cardmarket baisse nettement par rapport à sa moyenne des 30 derniers jours.
// Calculé chaque matin à partir du price guide public ; chaque produit est rapproché du catalogue TCGdex
// (image, série, nom français) et ce rapprochement est mémorisé dans la table cm_map.

const TCGDEX = 'https://api.tcgdex.net/v2';
export const CM_SINGLES = 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json';

export const CRITERIA = {
  minAvg30: 10,        // on ignore les cartes à moins de 10 € en moyenne (bruit)
  minDrop: -0.15,      // tendance au moins 15 % sous la moyenne 30 jours
  maxDrop: -0.6,       // au-delà de -60 %, c'est presque toujours une vente aberrante dans la moyenne
  keep: 300,           // nombre d'opportunités conservées
  resolveBudget: 700,  // appels au catalogue par jour pour retrouver les cartes
  recheckDays: 30,     // une carte non retrouvée est retentée après 30 jours
};

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

/** Nom Cardmarket "Charizard ex [Brave Wing | Explosion Impact]" -> "Charizard ex" */
export function cleanCmName(n) {
  return String(n || '').replace(/\[[^\]]*\]|\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}

/** Sélection des baisses significatives et cohérentes. */
export function pickDeals(guideRows, productsById, c = CRITERIA) {
  const out = [];
  for (const g of guideRows) {
    const p = productsById.get(Number(g.idProduct));
    if (!p || p.idCategory !== 51) continue;
    const trend = num(g.trend), avg30 = num(g.avg30), avg7 = num(g.avg7), low = num(g.low);
    if (!trend || !avg30 || !avg7 || !low || avg30 < c.minAvg30) continue;
    const drop = (trend - avg30) / avg30;
    if (drop > c.minDrop || drop < c.maxDrop) continue;
    if (avg7 > avg30 * 0.92) continue;                        // la semaine confirme la baisse
    if (trend < avg7 * 0.6 || trend > avg7 * 1.25) continue;  // tendance cohérente avec la semaine
    if (low > trend * 1.5) continue;                          // des offres existent autour du prix
    out.push({ cm_id: Number(g.idProduct), name: cleanCmName(p.name), expansion: p.idExpansion ?? null, trend, avg30, avg7, low, drop_pct: Math.round(drop * 1000) / 10 });
  }
  return out.sort((a, b) => a.drop_pct - b.drop_pct).slice(0, c.keep);
}

/**
 * Calcule et enregistre les opportunités.
 * ctx : { sb, fetchJson, fetchAll, guide (Map idProduct -> ligne), fetchImpl, now, log }
 */
export async function updateDeals({ sb, fetchJson, fetchAll, guide, fetchImpl, now = new Date(), log = () => {} }) {
  const singles = await fetchJson(CM_SINGLES, { fetchImpl });
  const productsById = new Map((singles?.products || []).map((p) => [Number(p.idProduct), p]));
  const deals = pickDeals([...guide.values()], productsById);

  // Rapprochements déjà connus
  const known = new Map((await fetchAll(sb, 'cm_map')).map((r) => [Number(r.cm_id), r]));
  // Série TCGdex la plus probable pour chaque extension Cardmarket (apprise des rapprochements passés)
  const expVotes = new Map();
  for (const r of known.values()) {
    const exp = productsById.get(Number(r.cm_id))?.idExpansion;
    if (exp == null || !r.set_id) continue;
    const v = expVotes.get(exp) || new Map(); v.set(r.set_id, (v.get(r.set_id) || 0) + 1); expVotes.set(exp, v);
  }
  const expSet = (exp) => { const v = expVotes.get(exp); return v ? [...v].sort((a, b) => b[1] - a[1])[0][0] : null; };

  let budget = CRITERIA.resolveBudget;
  const call = async (path) => { if (budget <= 0) throw new Error('budget'); budget--; return fetchJson(TCGDEX + path, { fetchImpl, tries: 2, timeoutMs: 15000 }); };
  const searchCache = new Map(), detailCache = new Map();
  const detail = async (id) => { if (!detailCache.has(id)) detailCache.set(id, await call(`/en/cards/${encodeURIComponent(id)}`).catch(() => null)); return detailCache.get(id); };
  const recheck = CRITERIA.recheckDays * 864e5;
  const newMaps = [];

  // Les plus chères d'abord : ce sont elles qui comptent
  for (const d of [...deals].sort((a, b) => b.avg30 - a.avg30)) {
    const k = known.get(d.cm_id);
    if (k && (k.card_id || now - new Date(k.checked_at) < recheck)) continue;
    if (budget <= 1) break;
    try {
      if (!searchCache.has(d.name)) searchCache.set(d.name, (await call(`/en/cards?name=${encodeURIComponent(d.name)}`)) || []);
      let cands = searchCache.get(d.name).filter((c) => c.name.toLowerCase() === d.name.toLowerCase());
      if (!cands.length) cands = searchCache.get(d.name);
      const guess = expSet(d.expansion);
      if (guess) cands = [...cands.filter((c) => c.id.startsWith(guess + '-')), ...cands.filter((c) => !c.id.startsWith(guess + '-'))];
      let hit = null;
      for (const c of cands.slice(0, 12)) {
        const full = await detail(c.id);
        const ids = [full?.pricing?.cardmarket?.idProduct, ...(full?.variants_detailed || []).map((v) => v?.thirdParty?.cardmarket)].filter(Boolean).map(Number);
        if (ids.includes(d.cm_id)) { hit = full; break; }
      }
      let fr = null;
      if (hit) fr = await call(`/fr/cards/${encodeURIComponent(hit.id)}`).catch(() => null);
      const row = hit
        ? { cm_id: d.cm_id, card_id: hit.id, set_id: hit.set?.id || null, name: hit.name, name_fr: fr?.name || null, image: fr?.image || hit.image || null,
            set_name: fr?.set?.name || hit.set?.name || null, local_id: hit.localId || null, rarity: fr?.rarity || hit.rarity || null, checked_at: now.toISOString() }
        : { cm_id: d.cm_id, card_id: null, set_id: null, name: d.name, name_fr: null, image: null, set_name: null, local_id: null, rarity: null, checked_at: now.toISOString() };
      known.set(d.cm_id, row); newMaps.push(row);
      if (hit && d.expansion != null && row.set_id) { const v = expVotes.get(d.expansion) || new Map(); v.set(row.set_id, (v.get(row.set_id) || 0) + 1); expVotes.set(d.expansion, v); }
    } catch (e) { if (e.message === 'budget') break; }
  }
  for (let i = 0; i < newMaps.length; i += 500) {
    const { error } = await sb.from('cm_map').upsert(newMaps.slice(i, i + 500), { onConflict: 'cm_id' });
    if (error) throw new Error(`Écriture cm_map : ${error.message}`);
  }

  const rows = deals.map((d) => {
    const m = known.get(d.cm_id);
    return {
      cm_id: d.cm_id, name: m?.card_id ? m.name : d.name, name_fr: m?.name_fr || null, trend: d.trend, avg30: d.avg30, avg7: d.avg7, low: d.low, drop_pct: d.drop_pct,
      lang: m?.card_id ? (m.name_fr ? 'fr' : 'en') : null, card_id: m?.card_id || null, image: m?.image || null, set_name: m?.set_name || null,
      local_id: m?.local_id || null, rarity: m?.rarity || null, updated_at: now.toISOString(),
    };
  });
  // On remplace la liste de la veille
  const del = await sb.from('deals').delete().gte('cm_id', 0);
  if (del.error) throw new Error(`Nettoyage deals : ${del.error.message}`);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('deals').insert(rows.slice(i, i + 500));
    if (error) throw new Error(`Écriture deals : ${error.message}`);
  }
  const resolved = rows.filter((r) => r.card_id).length;
  log(`Opportunités : ${rows.length} (${resolved} avec image), ${CRITERIA.resolveBudget - budget} appels catalogue`);
  return { deals: rows.length, dealsResolved: resolved };
}
