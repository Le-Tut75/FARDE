#!/usr/bin/env node
// Tâche quotidienne Farde : met à jour les cotes, l'historique et les portefeuilles.
// Lancée chaque matin par GitHub Actions (voir .github/workflows/prix-quotidiens.yml).
//
// Variables d'environnement :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (obligatoires)
//   TELEGRAM_BOT_TOKEN                        (facultatif : alertes wishlist)
import { createClient } from '@supabase/supabase-js';
import { buildIndex, findImage } from './sealed-images.mjs';
import { cmPrice, portfolio, cardKey, parisDay, DEFAULT_SETTINGS, variantKey, resolveCm } from '../app/js/valuation.js';

const TCGDEX = 'https://api.tcgdex.net/v2';
const CM = 'https://downloads.s3.cardmarket.com/productCatalog';
const CM_PRICE_GUIDE = `${CM}/priceGuide/price_guide_6.json`;          // 6 = Pokémon
const CM_NONSINGLES = `${CM}/productList/products_nonsingles_6.json`;
const CM_FIELDS = ['avg', 'low', 'trend', 'avg1', 'avg7', 'avg30', 'avg-holo', 'low-holo', 'trend-holo', 'avg1-holo', 'avg7-holo', 'avg30-holo'];
const CATEGORY_FALLBACK = { 52: 'Booster', 53: 'Display', 54: 'Deck', 1013: 'Kit', 1014: 'Pokébox / Tin', 1015: 'Coffret', 1016: 'ETB', 1017: 'Pièce', 1064: 'Set complet', 1083: 'Blister', 1654: 'Set complet' };
const ALERT_COOLDOWN_DAYS = 3;
const TCGCSV = 'https://tcgcsv.com/tcgplayer/3';   // catalogue TCGplayer Pokémon (photos des scellés)
const IMAGE_REFRESH_DAYS = 7;

/** Produits scellés TCGplayer (ceux sans rareté ni numéro), pour leurs photos. Une fois par semaine. */
export async function loadTcgSealed(fetchImpl) {
  const groups = (await fetchJson(`${TCGCSV}/groups`, { fetchImpl }))?.results || [];
  const out = [];
  for (const g of groups) {
    try {
      const prods = (await fetchJson(`${TCGCSV}/${g.groupId}/products`, { fetchImpl, tries: 2, timeoutMs: 30000 }))?.results || [];
      for (const p of prods) {
        const ext = (p.extendedData || []).map((e) => e.name);
        if (!ext.includes('Rarity') && !ext.includes('Number')) out.push({ productId: p.productId, name: p.name, imageUrl: p.imageUrl });
      }
    } catch { /* un groupe en échec : tant pis pour ses photos cette semaine */ }
    await sleep(150);   // règle de TCGCSV : pas de rafale
  }
  return out;
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson(url, { fetchImpl = fetch, tries = 3, timeoutMs = 60000 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetchImpl(url, { signal: ctrl.signal, headers: { 'user-agent': 'Farde/1.1.0' } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
      return await r.json();
    } catch (e) {
      last = e;
      await sleep(1000 * 2 ** i);
    } finally { clearTimeout(t); }
  }
  throw last;
}

async function pool(items, n, fn) {
  let i = 0;
  const out = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const j = i++; out[j] = await fn(items[j], j); }
  }));
  return out;
}

/** Lit toutes les lignes d'une table (contourne la limite de 1000 lignes par requête). */
export async function fetchAll(sb, table, columns = '*') {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`Lecture ${table} : ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function upsertChunks(sb, table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`Écriture ${table} : ${error.message}`);
  }
}

const hasPrice = (cm) => !!cm && CM_FIELDS.some((k) => typeof cm[k] === 'number' && cm[k] > 0);
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

function cmFromGuide(g) {
  if (!g) return null;
  const o = {};
  for (const k of CM_FIELDS) if (num(g[k]) != null) o[k] = g[k];
  return hasPrice(o) ? o : null;
}

function cmIdOf(card) {
  const direct = card?.pricing?.cardmarket?.idProduct;
  if (direct) return Number(direct);
  const v = (card?.variants_detailed || []).find((x) => x?.thirdParty?.cardmarket);
  return v ? Number(v.thirdParty.cardmarket) : null;
}

function historyRow(item, d, cm) {
  return {
    item, d,
    trend: num(cm?.trend), trend_holo: num(cm?.['trend-holo']),
    avg30: num(cm?.avg30), avg30_holo: num(cm?.['avg30-holo']),
    low: num(cm?.low), low_holo: num(cm?.['low-holo']),
  };
}

export async function run({ sb, fetchImpl = fetch, telegramToken = null, now = new Date() } = {}) {
  const d = parisDay(now);
  const summary = { day: d, cards: 0, cardsPriced: 0, cardsFallback: 0, cardsFailed: 0, sealedCatalog: 0, sealedTracked: 0, users: 0, alerts: 0, warnings: [] };
  const { data: runRow } = await sb.from('job_runs').insert({ summary }).select('id').single();

  try {
    // 1. Fichiers publics Cardmarket (prix du jour + catalogue des scellés)
    let guide = new Map();
    try {
      const pg = await fetchJson(CM_PRICE_GUIDE, { fetchImpl });
      for (const g of pg?.priceGuides || []) guide.set(Number(g.idProduct), g);
      log(`Cardmarket : ${guide.size} cotes`);
    } catch (e) { summary.warnings.push(`Price guide Cardmarket indisponible : ${e.message}`); log(summary.warnings.at(-1)); }

    if (guide.size) {
      try {
        const ns = await fetchJson(CM_NONSINGLES, { fetchImpl });
        // Photos : recalculées une fois par semaine (ou si de nouveaux produits n'en ont jamais eu)
        let imageIndex = null;
        const { data: oldest } = await sb.from('cm_sealed').select('image_checked_at').order('image_checked_at', { ascending: true, nullsFirst: true }).limit(1);
        const due = !oldest?.length || !oldest[0].image_checked_at || now - new Date(oldest[0].image_checked_at) > IMAGE_REFRESH_DAYS * 864e5;
        if (due) {
          try { const tcg = await loadTcgSealed(fetchImpl); if (tcg.length > 100) imageIndex = buildIndex(tcg); log(`Photos : ${tcg.length} produits TCGplayer`); }
          catch (e) { summary.warnings.push(`Photos des scellés indisponibles cette fois : ${e.message}`); }
        }
        const rows = (ns?.products || []).map((p) => {
          const g = guide.get(Number(p.idProduct));
          const img = imageIndex ? { image: findImage(imageIndex, p.name), image_checked_at: now.toISOString() } : {};
          return { ...img,
            id: Number(p.idProduct), name: p.name, category_id: p.idCategory ?? null,
            category: CATEGORY_FALLBACK[p.idCategory] || p.categoryName || 'Autre', expansion_id: p.idExpansion ?? null,
            trend: num(g?.trend), low: num(g?.low), avg1: num(g?.avg1), avg7: num(g?.avg7), avg30: num(g?.avg30),
            updated_at: now.toISOString(),
          };
        });
        await upsertChunks(sb, 'cm_sealed', rows, 'id');
        summary.sealedCatalog = rows.length;
        if (imageIndex) summary.sealedPhotos = rows.filter((r) => r.image).length;
        log(`Catalogue scellés : ${rows.length} produits`);
      } catch (e) { summary.warnings.push(`Catalogue scellés indisponible : ${e.message}`); log(summary.warnings.at(-1)); }
    }

    // 2. Cartes suivies (collection + wishlist de tous les utilisateurs)
    const coll = await fetchAll(sb, 'collection', 'user_id,lang,card_id,name,local_id,set_name,image,variant,condition,qty,buy_price,manual_price,grading_company');
    const wish = await fetchAll(sb, 'wishlist', 'id,user_id,lang,card_id,name,variant,target_price,last_alert_at');
    const tracked = [...new Map([...coll, ...wish].map((r) => [cardKey(r.lang, r.card_id), r])).values()];
    summary.cards = tracked.length;
    const existing = new Map((await fetchAll(sb, 'card_prices')).map((r) => [cardKey(r.lang, r.card_id), r]));

    const priceRows = [], hist = [];
    await pool(tracked, 8, async (t) => {
      const key = cardKey(t.lang, t.card_id);
      let card = null;
      try { card = await fetchJson(`${TCGDEX}/${t.lang}/cards/${encodeURIComponent(t.card_id)}`, { fetchImpl, timeoutMs: 20000 }); }
      catch (e) { summary.cardsFailed++; return; }
      const prev = existing.get(key);
      const cmId = cmIdOf(card) ?? prev?.cm_id ?? null;
      let cm = hasPrice(card?.pricing?.cardmarket) ? card.pricing.cardmarket : null, source = 'tcgdex';
      if (!cm && cmId) { cm = cmFromGuide(guide.get(cmId)); source = 'cardmarket'; if (cm) summary.cardsFallback++; }
      if (!cm && !card) { summary.cardsFailed++; return; }
      if (cm) summary.cardsPriced++;
      priceRows.push({
        lang: t.lang, card_id: t.card_id, cm_id: cmId,
        name: card?.name ?? prev?.name ?? t.name, set_name: card?.set?.name ?? prev?.set_name ?? null,
        local_id: card?.localId ?? prev?.local_id ?? null, image: card?.image ?? prev?.image ?? null,
        cm: cm ?? prev?.cm ?? null, tcgplayer: card?.pricing?.tcgplayer ?? prev?.tcgplayer ?? null,
        source: cm ? source : prev?.source ?? null, updated_at: now.toISOString(),
      });
      if (cm) hist.push(historyRow(`card:${key}`, d, cm));
      // Variantes cotées à part sur Cardmarket (reverse Poké Ball, Master Ball…)
      const vd = Array.isArray(card?.variants_detailed) ? card.variants_detailed : [];
      const baseId = Number(vd.find((v) => v.type === 'normal')?.thirdParty?.cardmarket ?? vd[0]?.thirdParty?.cardmarket ?? cmId ?? 0);
      const variants = [];
      for (const v of vd) {
        const id = Number(v?.thirdParty?.cardmarket || 0);
        if (!id || id === baseId) continue;
        const vcm = cmFromGuide(guide.get(id));
        const vkey = variantKey(v);
        if (variants.some((x) => x.key === vkey)) continue;
        variants.push({ key: vkey, cm_id: id, cm: vcm });
        if (vcm) hist.push(historyRow(`card:${key}~${vkey}`, d, vcm));
      }
      priceRows.at(-1).variants = variants.length ? variants : (prev?.variants ?? null);
    });
    await upsertChunks(sb, 'card_prices', priceRows, 'lang,card_id');
    log(`Cartes : ${summary.cardsPriced}/${tracked.length} cotées (${summary.cardsFallback} via Cardmarket, ${summary.cardsFailed} en échec)`);

    // 3. Scellés suivis
    const sealed = await fetchAll(sb, 'sealed', 'user_id,cm_id,qty,buy_price,manual_price');
    const sealedIds = [...new Set(sealed.filter((s) => s.cm_id != null).map((s) => Number(s.cm_id)))];
    const sealedMap = new Map();
    for (let i = 0; i < sealedIds.length; i += 200) {
      const { data, error } = await sb.from('cm_sealed').select('*').in('id', sealedIds.slice(i, i + 200));
      if (error) throw new Error(`Lecture cm_sealed : ${error.message}`);
      for (const r of data) sealedMap.set(Number(r.id), r);
    }
    for (const id of sealedIds) {
      const r = sealedMap.get(id);
      if (r && (r.trend || r.avg30)) { hist.push({ item: `sealed:${id}`, d, trend: num(Number(r.trend)), trend_holo: null, avg30: num(Number(r.avg30)), avg30_holo: null, low: num(Number(r.low)), low_holo: null }); summary.sealedTracked++; }
    }
    await upsertChunks(sb, 'price_history', hist, 'item,d');

    // 4. Portefeuille de chaque utilisateur
    const priceMap = new Map((await fetchAll(sb, 'card_prices', 'lang,card_id,cm,variants')).map((r) => [cardKey(r.lang, r.card_id), r]));
    const settingsMap = new Map((await fetchAll(sb, 'user_settings')).map((s) => [s.user_id, { ...DEFAULT_SETTINGS, ...s, cond: { ...DEFAULT_SETTINGS.cond, ...(s.cond || {}) } }]));
    const users = new Set([...coll.map((c) => c.user_id), ...sealed.map((s) => s.user_id)]);
    const snaps = [];
    for (const u of users) {
      const st = settingsMap.get(u) || DEFAULT_SETTINGS;
      const p = portfolio(coll.filter((c) => c.user_id === u), sealed.filter((s) => s.user_id === u), priceMap, sealedMap, st);
      snaps.push({ user_id: u, d, value: p.value, invested: p.invested, cards_value: p.cardsValue, sealed_value: p.sealedValue });
    }
    await upsertChunks(sb, 'portfolio_history', snaps, 'user_id,d');
    summary.users = snaps.length;

    // 5. Alertes wishlist (Telegram, facultatif)
    if (telegramToken) {
      for (const w of wish) {
        if (w.target_price == null) continue;
        const st = settingsMap.get(w.user_id);
        if (!st?.telegram_chat_id) continue;
        const r = resolveCm(priceMap.get(cardKey(w.lang, w.card_id)), w.variant);
        const price = cmPrice(r.cm, st.basis, r.variant);
        if (price == null || price > Number(w.target_price)) continue;
        if (w.last_alert_at && now - new Date(w.last_alert_at) < ALERT_COOLDOWN_DAYS * 864e5) continue;
        const text = `🔔 ${w.name} est à ${price.toFixed(2).replace('.', ',')} € (ton prix cible : ${Number(w.target_price).toFixed(2).replace('.', ',')} €)`;
        try {
          const r = await fetchImpl(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ chat_id: st.telegram_chat_id, text }),
          });
          if (r.ok) { await sb.from('wishlist').update({ last_alert_at: now.toISOString() }).eq('id', w.id); summary.alerts++; }
          else summary.warnings.push(`Telegram a refusé l'envoi (${r.status})`);
        } catch (e) { summary.warnings.push(`Telegram injoignable : ${e.message}`); }
      }
    }

    const ok = summary.cardsFailed <= Math.max(3, tracked.length * 0.2);
    if (!ok) summary.warnings.push('Trop de cartes en échec : TCGdex est peut-être en panne.');
    await sb.from('job_runs').update({ finished_at: new Date().toISOString(), ok, summary }).eq('id', runRow?.id);
    log('Terminé', JSON.stringify(summary));
    return { ok, summary };
  } catch (e) {
    summary.warnings.push(e.message);
    await sb.from('job_runs').update({ finished_at: new Date().toISOString(), ok: false, summary }).eq('id', runRow?.id);
    throw e;
  }
}

// Exécution directe : node update-prices.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('Il manque la variable SUPABASE_URL ou le secret SUPABASE_SERVICE_ROLE_KEY (GitHub › Settings › Secrets and variables › Actions).'); process.exit(1); }
  const sb = createClient(new URL(url.trim()).origin, key.trim(), { auth: { persistSession: false } });
  run({ sb, telegramToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || null })
    .then(({ ok }) => process.exit(ok ? 0 : 1))
    .catch((e) => { console.error('ÉCHEC :', e.message); process.exit(1); });
}
