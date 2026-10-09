#!/usr/bin/env node
// Veille eBay (bêta) : pour chaque recherche enregistrée, récupère les annonces les plus récentes via l'API officielle
// eBay (Browse API), garde les nouvelles et prévient sur Telegram. Lancée toutes les heures par GitHub Actions.
//
// Variables d'environnement :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (obligatoires)
//   EBAY_CLIENT_ID, EBAY_CLIENT_SECRET        (clés « Production » du compte développeur eBay)
//   TELEGRAM_BOT_TOKEN                        (facultatif)
import { createClient } from '@supabase/supabase-js';
import { landed, scoreItem, DEFAULT_PREFS } from '../app/js/ebayscore.js';

const API = 'https://api.ebay.com';
const KEEP_DAYS = 30;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// Reconnaissance dans le titre de l'annonce
export const GRADED = /\b(psa|cgc|bgs|beckett|pca|sgc|ace|collect\s*aura|tag)\s*[-:]?\s*(10|9\.5|9|8\.5|8|7\.5|7|6|5|4|3|2|1)\b|\b(gem\s*mint|graded|grad[ée]e?|slab)\b/i;
export const FIRST_ED = /\b1st\b|\bfirst\s*ed(ition)?\b|\bed(ition)?\s*\.?\s*1\b|\b1(e|ère|ere|re)\s*[ée]d(ition)?\b|(?:^|[^a-zà-ÿ])[ée]dition\s*1\b|\bed1\b|\b1\.?\s*auflage\b|\bprima\s*edizione\b|\bprimera\s*edici[oó]n\b/i;

/** Jeton d'application (client credentials), valable 2 h. */
export async function ebayToken(id, secret, fetchImpl = fetch) {
  const r = await fetchImpl(`${API}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') },
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope'),
  });
  if (!r.ok) throw new Error(`eBay refuse les clés (${r.status}). Vérifie EBAY_CLIENT_ID et EBAY_CLIENT_SECRET (clés « Production »).`);
  return (await r.json()).access_token;
}

const CUR = { EBAY_FR: 'EUR', EBAY_DE: 'EUR', EBAY_IT: 'EUR', EBAY_ES: 'EUR', EBAY_GB: 'GBP', EBAY_US: 'USD' };

/** Paramètres de recherche eBay pour une recherche enregistrée. */
export function searchUrl(s, market) {
  const filters = [];
  if (s.buying === 'auction') filters.push('buyingOptions:{AUCTION}');
  else if (s.buying === 'fixed') filters.push('buyingOptions:{FIXED_PRICE}');
  else filters.push('buyingOptions:{AUCTION|FIXED_PRICE}');
  if (s.max_price) filters.push(`price:[..${Number(s.max_price)}]`, `priceCurrency:${CUR[market] || 'EUR'}`);
  const p = new URLSearchParams({ q: s.q, sort: 'newlyListed', limit: '100', filter: filters.join(',') });
  return `${API}/buy/browse/v1/item_summary/search?${p}`;
}

// ---- Taux de change (BCE, publiés chaque jour ouvré) ----
const FX_FALLBACK = { EUR: 1, GBP: 0.86, USD: 1.08, CHF: 0.94, JPY: 165, CAD: 1.48, AUD: 1.65 };   // unités pour 1 €
export async function fxRates(fetchImpl = fetch) {
  try {
    const r = await fetchImpl('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml', { headers: { 'user-agent': 'Farde/1.6' } });
    if (!r.ok) throw new Error(String(r.status));
    const xml = await r.text();
    const out = { EUR: 1 };
    for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) out[m[1]] = Number(m[2]);
    if (out.USD && out.GBP) return { rates: out, source: 'BCE' };
  } catch { /* on prend les taux de secours */ }
  return { rates: FX_FALLBACK, source: 'secours' };
}
export const toEur = (v, cur, rates) => (v == null || !rates[cur || 'EUR'] ? null : Math.round((Number(v) / rates[cur || 'EUR']) * 100) / 100);

/** Champs d'une annonce eBay -> ligne de la table (prix convertis en euros, port vers la France). */
export function itemRow(it, rates) {
  const ship = (it.shippingOptions || []).find((o) => o.shippingCost) || null;
  return {
    title: String(it.title || '').slice(0, 300),
    price: it.price ? Number(it.price.value) : null, currency: it.price?.currency || null,
    bid_price: it.currentBidPrice ? Number(it.currentBidPrice.value) : null, bid_count: it.bidCount ?? null,
    price_eur: it.price ? toEur(it.price.value, it.price.currency, rates) : null,
    bid_eur: it.currentBidPrice ? toEur(it.currentBidPrice.value, it.currentBidPrice.currency, rates) : null,
    ship_eur: ship ? toEur(ship.shippingCost.value, ship.shippingCost.currency, rates) : null,
    buying: it.buyingOptions || null, end_at: it.itemEndDate || null, image: it.image?.imageUrl || it.thumbnailImages?.[0]?.imageUrl || null,
    url: it.itemWebUrl || null, seller: it.seller?.username || null, seller_score: it.seller?.feedbackPercentage || null,
    feedback_count: it.seller?.feedbackScore ?? null, country: it.itemLocation?.country || null,
    photos: it.image || it.additionalImages ? (it.image ? 1 : 0) + (it.additionalImages?.length || 0) : null,
  };
}

/** Garde les annonces qui correspondent vraiment (gradée, 1re édition, mots exclus). */
export function keep(s, it) {
  const t = it.title || '';
  if (s.graded_only && !GRADED.test(t)) return false;
  if (s.first_ed && !FIRST_ED.test(t)) return false;
  const ex = String(s.exclude || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
  if (ex.some((w) => t.toLowerCase().includes(w))) return false;
  if (/\b(proxy|fake|custom|replica|orica|repro)\b/i.test(t)) return false;
  return true;
}

export async function runEbay({ sb, fetchImpl = fetch, clientId, clientSecret, telegramToken = null, now = new Date() }) {
  const summary = { searches: 0, calls: 0, found: 0, fresh: 0, alerts: 0, errors: [] };
  const { data: searches, error } = await sb.from('ebay_searches').select('*').eq('active', true);
  if (error) throw new Error(`Lecture des recherches eBay : ${error.message}`);
  if (!searches.length) { log('Aucune recherche eBay active.'); return summary; }
  const token = await ebayToken(clientId, clientSecret, fetchImpl);
  let { data: settings, error: se } = await sb.from('user_settings').select('user_id,telegram_chat_id,ebay_prefs');
  if (se) ({ data: settings } = await sb.from('user_settings').select('user_id,telegram_chat_id'));
  const chatOf = new Map((settings || []).map((s) => [s.user_id, s.telegram_chat_id]));
  const prefsOf = new Map((settings || []).map((s) => [s.user_id, { ...DEFAULT_PREFS, ...(s.ebay_prefs || {}) }]));
  const { rates, source } = await fxRates(fetchImpl);
  summary.fx = source;
  const freshByUser = new Map();

  for (const s of searches) {
    summary.searches++;
    let err = null;
    const { data: known } = await sb.from('ebay_items').select('item_id').eq('search_id', s.id);
    const seen = new Set((known || []).map((k) => k.item_id));
    const first = seen.size === 0 && !s.last_run_at;   // 1er passage : on enregistre sans alerter (sinon 100 alertes d'un coup)
    const rows = [], refresh = [];
    for (const market of s.markets?.length ? s.markets : ['EBAY_FR']) {
      try {
        summary.calls++;
        // Livraison en France : eBay calcule alors les frais de port vers Paris
        const r = await fetchImpl(searchUrl(s, market), { headers: { authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': market, 'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country%3DFR%2Czip%3D75001', 'accept-language': 'fr-FR' } });
        if (!r.ok) { err = `eBay ${market} : erreur ${r.status}`; continue; }
        const body = await r.json();
        for (const it of body.itemSummaries || []) {
          if (!keep(s, it)) continue;
          const base = { search_id: s.id, item_id: it.itemId, user_id: s.user_id, market, ...itemRow(it, rates), updated_at: now.toISOString() };
          // Annonce déjà connue : on met à jour l'enchère, le prix et le port (sans toucher à la date de découverte)
          if (seen.has(it.itemId)) { if (!refresh.some((x) => x.item_id === it.itemId)) refresh.push(base); continue; }
          seen.add(it.itemId);
          rows.push({ ...base, first_seen_at: now.toISOString() });
        }
      } catch (e) { err = `eBay ${market} : ${e.message}`; }
    }
    summary.found += rows.length;
    if (rows.length) {
      const { error: e2 } = await sb.from('ebay_items').upsert(rows, { onConflict: 'search_id,item_id', ignoreDuplicates: true });
      if (e2) err = `Écriture : ${e2.message}`;
    }
    if (refresh.length) {
      const { error: e3 } = await sb.from('ebay_items').upsert(refresh, { onConflict: 'search_id,item_id' });
      if (e3) err = `Mise à jour : ${e3.message}`;
      summary.refreshed = (summary.refreshed || 0) + refresh.length;
    }
    if (!first && s.alert && rows.length) {
      // Score : chaque nouvelle annonce comparée aux autres annonces de la recherche
      const { data: peers } = await sb.from('ebay_items').select('*').eq('search_id', s.id).eq('hidden', false);
      const prefs = prefsOf.get(s.user_id) || DEFAULT_PREFS;
      if (!freshByUser.has(s.user_id)) freshByUser.set(s.user_id, []);
      freshByUser.get(s.user_id).push(...rows.map((r) => ({ ...r, label: s.label, sc: scoreItem(r, peers || [], prefs) })));
    }
    if (!first) summary.fresh += rows.length;
    await sb.from('ebay_searches').update({ last_run_at: now.toISOString(), last_error: err }).eq('id', s.id);
    if (err) summary.errors.push(`${s.label} : ${err}`);
  }

  // Alertes Telegram : un message par utilisateur, 10 annonces maximum
  if (telegramToken) {
    const money = (v, c) => (v == null ? '' : `${Number(v).toFixed(2).replace('.', ',')} ${c === 'EUR' ? '€' : c || ''}`);
    for (const [u, list] of freshByUser) {
      const chat = chatOf.get(u);
      if (!chat) continue;
      // Les meilleures d'abord
      list.sort((a, b) => b.sc.score - a.sc.score);
      const lines = list.slice(0, 10).map((r) => {
        const auction = r.buying?.includes('AUCTION');
        const end = r.end_at ? new Date(r.end_at) : null;
        const left = end ? Math.max(0, Math.round((end - now) / 36e5)) : null;
        const L = r.sc.landed, dot = { ok: '🟢', al: '🟠', err: '🔴' }[r.sc.level];
        return `${auction ? '🔨' : '🛒'} ${r.title}\n${auction ? `Enchère ${money(r.bid_price ?? r.price, r.currency)}${r.bid_count ? ` (${r.bid_count} offre${r.bid_count > 1 ? 's' : ''})` : ''}${left != null ? ` · fin dans ${left < 48 ? left + ' h' : Math.round(left / 24) + ' j'}` : ''}` : `Achat immédiat ${money(r.price, r.currency)}`} · ${r.market.replace('EBAY_', '')}`
          + `\n💶 Rendu France ≈ ${L ? money(L.total, 'EUR') + (L.shipKnown ? '' : ' (+ port)') : '?'} · ${dot} Score ${r.sc.score}/100${r.sc.gap != null ? ` (${r.sc.gap <= 0 ? '−' : '+'}${Math.abs(Math.round(r.sc.gap))} % vs annonces comparables)` : ''}\n${r.url}`;
      });
      const text = `🆕 eBay · ${list.length} nouvelle${list.length > 1 ? 's' : ''} annonce${list.length > 1 ? 's' : ''} (${[...new Set(list.map((r) => r.label))].join(', ')})\n\n${lines.join('\n\n')}${list.length > 10 ? `\n\n… et ${list.length - 10} autres dans Farde.` : ''}`;
      try {
        const r = await fetchImpl(`https://api.telegram.org/bot${telegramToken}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }) });
        if (r.ok) summary.alerts++;
      } catch { /* on réessaiera à la prochaine annonce */ }
    }
  }

  // Ménage : annonces vues il y a plus de 30 jours
  await sb.from('ebay_items').delete().lt('first_seen_at', new Date(now - KEEP_DAYS * 864e5).toISOString());
  log('eBay', JSON.stringify(summary));
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const id = process.env.EBAY_CLIENT_ID?.trim(), secret = process.env.EBAY_CLIENT_SECRET?.trim();
  if (!url || !key) { console.error('Il manque SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }
  if (!id || !secret) { console.log('Veille eBay non configurée : ajoute les secrets EBAY_CLIENT_ID et EBAY_CLIENT_SECRET (voir le guide). Rien à faire.'); process.exit(0); }
  const sb = createClient(new URL(url.trim()).origin, key.trim(), { auth: { persistSession: false } });
  runEbay({ sb, clientId: id, clientSecret: secret, telegramToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || null })
    .then((s) => process.exit(s.errors.length && !s.found ? 1 : 0))
    .catch((e) => { console.error('ÉCHEC :', e.message); process.exit(1); });
}
