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
  // Périodes longues (3, 6, 12 mois) : baisse par rapport à la moyenne du mois d'il y a N jours
  longMinDrop: -0.2,   // au moins 20 % sous le niveau d'il y a 3 / 6 / 12 mois
  longMaxDrop: -0.8,
  snapshotMin: 5,      // historique : seulement les cartes à 5 € et plus (taille de la base)
  snapshotEvery: 7,    // un relevé par semaine
  keepDays: 400,
};
export const WINDOWS = [90, 180, 365];
const DAY = 864e5;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * Relevé hebdomadaire du marché (cartes à l'unité à 5 € et plus) et lecture des relevés utiles.
 * Renvoie Map(cm_id -> { 90: avg30, 180: avg30, 365: avg30 }) et la date du premier relevé.
 */
export async function marketHistory({ sb, guide, productsById, now, c = CRITERIA, log = () => {} }) {
  const { data: last } = await sb.from('market_history').select('d').order('d', { ascending: false }).limit(1);
  const lastD = last?.[0]?.d ? new Date(last[0].d + 'T12:00:00Z') : null;
  let added = 0;
  if (!lastD || now - lastD >= (c.snapshotEvery - 0.5) * DAY) {
    const d = iso(now), rows = [{ cm_id: 0, d, trend: null, avg30: null }];   // ligne repère : liste des dates de relevé
    for (const g of guide.values()) {
      const p = productsById.get(Number(g.idProduct));
      if (!p || p.idCategory !== 51) continue;
      const a30 = num(g.avg30), tr = num(g.trend);
      if (!a30 || a30 < c.snapshotMin) continue;
      rows.push({ cm_id: Number(g.idProduct), d, trend: tr, avg30: a30 });
    }
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await sb.from('market_history').upsert(rows.slice(i, i + 1000), { onConflict: 'cm_id,d' });
      if (error) throw new Error(`Écriture market_history : ${error.message}`);
    }
    added = rows.length - 1;
    await sb.from('market_history').delete().lt('d', iso(now - c.keepDays * DAY));
    log(`Historique du marché : relevé de ${added} cartes`);
  }
  // Dates de relevé disponibles, puis celle la plus proche de chaque période (à 10 jours près)
  const { data: marks } = await sb.from('market_history').select('d').eq('cm_id', 0).order('d');
  const all = (marks || []).map((r) => r.d);
  const since = all[0] || null;
  const refs = new Map();
  if (since) {
    for (const w of WINDOWS) {
      const target = now - w * DAY;
      const ds = all.filter((x) => Math.abs(new Date(x + 'T12:00:00Z') - target) <= 10 * DAY);
      if (!ds.length) continue;
      const best = ds.sort((a, b) => Math.abs(new Date(a + 'T12:00:00Z') - target) - Math.abs(new Date(b + 'T12:00:00Z') - target))[0];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('market_history').select('cm_id,avg30').eq('d', best).range(from, from + 999);
        if (error) throw new Error(`Lecture market_history : ${error.message}`);
        for (const r of data) { const o = refs.get(r.cm_id) || {}; o[w] = Number(r.avg30); refs.set(r.cm_id, o); }
        if (data.length < 1000) break;
      }
    }
  }
  return { refs, since, added };
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

/** Nom Cardmarket "Charizard ex [Brave Wing | Explosion Impact]" -> "Charizard ex" */
export function cleanCmName(n) {
  return String(n || '').replace(/\[[^\]]*\]|\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}

/** Sélection des baisses significatives et cohérentes. */
export function pickDeals(guideRows, productsById, c = CRITERIA, refs = new Map()) {
  const byWin = { 30: [], 90: [], 180: [], 365: [] };
  const all = new Map();
  const pct = (v) => Math.round(v * 1000) / 10;
  for (const g of guideRows) {
    const p = productsById.get(Number(g.idProduct));
    if (!p || p.idCategory !== 51) continue;
    const trend = num(g.trend), avg30 = num(g.avg30), avg7 = num(g.avg7), low = num(g.low);
    if (!trend || !avg30 || !avg7 || !low) continue;
    if (trend < avg7 * 0.6 || trend > avg7 * 1.25) continue;  // tendance cohérente avec la semaine
    if (low > trend * 1.5) continue;                          // des offres existent autour du prix
    const id = Number(g.idProduct);
    const row = { cm_id: id, name: cleanCmName(p.name), expansion: p.idExpansion ?? null, trend, avg30, avg7, low, drop_pct: pct((trend - avg30) / avg30), win: [] };
    // 30 jours : la tendance et la semaine sont sous la moyenne du mois
    const drop = (trend - avg30) / avg30;
    if (avg30 >= c.minAvg30 && drop <= c.minDrop && drop >= c.maxDrop && avg7 <= avg30 * 0.92) { row.win.push('30'); byWin[30].push(row); }
    // 3, 6, 12 mois : la tendance et la semaine sont sous le niveau d'il y a N jours (moyenne du mois à cette date)
    const r = refs.get(id) || {};
    for (const w of WINDOWS) {
      const ref = r[w];
      if (!ref) continue;
      row[`ref_${w}`] = ref; row[`drop_${w}`] = pct((trend - ref) / ref);
      const dl = (trend - ref) / ref;
      if (ref >= c.minAvg30 && dl <= c.longMinDrop && dl >= c.longMaxDrop && avg7 <= ref * 0.9) { row.win.push(String(w)); byWin[w].push(row); }
    }
    if (row.win.length) all.set(id, row);
  }
  // Les plus fortes baisses de chaque période
  const keep = new Set();
  byWin[30].sort((a, b) => a.drop_pct - b.drop_pct).slice(0, c.keep).forEach((r) => keep.add(r.cm_id));
  for (const w of WINDOWS) byWin[w].sort((a, b) => a[`drop_${w}`] - b[`drop_${w}`]).slice(0, c.keep).forEach((r) => keep.add(r.cm_id));
  return [...keep].map((id) => all.get(id)).sort((a, b) => a.drop_pct - b.drop_pct);
}

/**
 * Calcule et enregistre les opportunités.
 * ctx : { sb, fetchJson, fetchAll, guide (Map idProduct -> ligne), fetchImpl, now, log }
 */
export async function updateDeals({ sb, fetchJson, fetchAll, guide, fetchImpl, now = new Date(), log = () => {} }) {
  const singles = await fetchJson(CM_SINGLES, { fetchImpl });
  const productsById = new Map((singles?.products || []).map((p) => [Number(p.idProduct), p]));
  let hist = { refs: new Map(), since: null, added: 0 };
  try { hist = await marketHistory({ sb, guide, productsById, now, log }); }
  catch (e) { log(`Historique du marché indisponible : ${e.message}`); }
  const deals = pickDeals([...guide.values()], productsById, CRITERIA, hist.refs);

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
      ref_90: d.ref_90 ?? null, ref_180: d.ref_180 ?? null, ref_365: d.ref_365 ?? null, drop_90: d.drop_90 ?? null, drop_180: d.drop_180 ?? null, drop_365: d.drop_365 ?? null, win: d.win,
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
  return { deals: rows.length, dealsResolved: resolved, marketSince: hist.since, marketSnapshot: hist.added, dealsLong: Object.fromEntries(WINDOWS.map((w) => [w, rows.filter((r) => r.win.includes(String(w))).length])) };
}
