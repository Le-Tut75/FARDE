// Variations de cote des cartes de chaque collection (7 et 30 jours) + alertes Telegram.
import { cardKey, resolveCm } from '../app/js/valuation.js';

const KEEP = 40;                 // variations gardées par utilisateur et par période
const ALERT_PCT = 25;            // seuil d'alerte (en % sur 7 jours)
const ALERT_MIN_EUR = 5;         // impact minimum sur la valeur de la ligne
const ALERT_COOLDOWN_DAYS = 7;

const shift = (d, days) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - days); return x.toISOString().slice(0, 10); };
const fr = (v) => v.toFixed(2).replace('.', ',');

/**
 * coll : lignes de collection ; priceMap : Map(lang:id -> card_prices) ; d : jour (AAAA-MM-JJ)
 * Écrit la table movers et renvoie { movers, moverAlerts }.
 */
export async function updateMovers({ sb, coll, priceMap, d, now, settingsMap, telegramToken, fetchImpl, log = () => {} }) {
  // 1. Pour chaque ligne : quel historique suivre (variante cotée à part, reverse, ou carte)
  const lines = [];
  for (const l of coll) {
    const row = priceMap.get(cardKey(l.lang, l.card_id));
    if (!row) continue;
    const r = resolveCm(row, l.variant);
    if (!r.cm) continue;
    const own = !!r.own;
    const foil = !own && String(l.variant).startsWith('reverse');
    const item = own ? `card:${l.lang}:${l.card_id}~${l.variant}` : `card:${l.lang}:${l.card_id}`;
    const now = Number(foil ? (r.cm['trend-holo'] ?? r.cm.trend) : (r.cm.trend ?? r.cm['trend-holo']));
    if (!(now > 0)) continue;
    lines.push({ l, item, foil, now });
  }
  if (!lines.length) return { movers: 0, moverAlerts: 0 };

  // 2. Cotes d'il y a 7 et 30 jours (à un jour près si la tâche n'a pas tourné ce jour-là)
  const want = { 7: [shift(d, 7), shift(d, 6), shift(d, 8)], 30: [shift(d, 30), shift(d, 29), shift(d, 31)] };
  const dates = [...want[7], ...want[30]];
  const items = [...new Set(lines.map((x) => x.item))];
  const hist = new Map();   // item -> Map(d -> row)
  for (let i = 0; i < items.length; i += 150) {
    const { data, error } = await sb.from('price_history').select('item,d,trend,trend_holo').in('item', items.slice(i, i + 150)).in('d', dates);
    if (error) throw new Error(`Lecture de l'historique : ${error.message}`);
    for (const r of data) { if (!hist.has(r.item)) hist.set(r.item, new Map()); hist.get(r.item).set(r.d, r); }
  }
  const past = (x, days) => {
    const h = hist.get(x.item); if (!h) return null;
    for (const dd of want[days]) {
      const r = h.get(dd); if (!r) continue;
      const v = Number(x.foil ? (r.trend_holo ?? r.trend) : (r.trend ?? r.trend_holo));
      if (v > 0) return v;
    }
    return null;
  };

  // 3. Par utilisateur : on regroupe les exemplaires d'une même carte et on garde les plus gros mouvements
  const byUser = new Map();
  for (const x of lines) {
    const key = `${x.l.user_id}|${x.item}|${x.foil}`;
    let m = byUser.get(x.l.user_id); if (!m) byUser.set(x.l.user_id, (m = new Map()));
    const cur = m.get(key);
    if (cur) { cur.qty += x.l.qty || 1; continue; }
    m.set(key, { x, qty: x.l.qty || 1, p7: past(x, 7), p30: past(x, 30) });
  }
  const { data: old } = await sb.from('movers').select('user_id,item,alerted_at');
  const alerted = new Map((old || []).map((r) => [`${r.user_id}|${r.item}`, r.alerted_at]));
  const rows = [], alertsByUser = new Map();
  for (const [u, m] of byUser) {
    const all = [...m.values()].filter((v) => v.p7 || v.p30);
    const impact = (v, p) => (p ? Math.abs(v.x.now - p) * v.qty : 0);
    const keep = new Set([
      ...[...all].sort((a, b) => impact(b, b.p7) - impact(a, a.p7)).slice(0, KEEP),
      ...[...all].sort((a, b) => impact(b, b.p30) - impact(a, a.p30)).slice(0, KEEP),
    ]);
    for (const v of keep) {
      const l = v.x.l, item = v.x.item + (v.x.foil ? '#reverse' : '');
      const row = { user_id: u, item, lang: l.lang, card_id: l.card_id, name: l.name, set_name: l.set_name, local_id: l.local_id, image: l.image, variant: l.variant,
        qty: v.qty, price: v.x.now, price7: v.p7, price30: v.p30, updated_at: now.toISOString(), alerted_at: alerted.get(`${u}|${item}`) ?? null };
      // Alerte : forte variation sur 7 jours, avec un vrai impact en euros
      if (v.p7) {
        const pct = ((v.x.now - v.p7) / v.p7) * 100;
        const last = row.alerted_at ? new Date(row.alerted_at) : null;
        if (Math.abs(pct) >= ALERT_PCT && Math.abs(v.x.now - v.p7) * v.qty >= ALERT_MIN_EUR && (!last || now - last > ALERT_COOLDOWN_DAYS * 864e5)) {
          if (!alertsByUser.has(u)) alertsByUser.set(u, []);
          alertsByUser.get(u).push({ row, pct });
        }
      }
      rows.push(row);
    }
  }
  // 4. Écriture : on remplace les variations de la veille
  for (const u of byUser.keys()) {
    const { error } = await sb.from('movers').delete().eq('user_id', u);
    if (error) throw new Error(`Écriture movers : ${error.message}`);
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('movers').insert(rows.slice(i, i + 500));
    if (error) throw new Error(`Écriture movers : ${error.message}`);
  }
  log(`Variations : ${rows.length} lignes pour ${byUser.size} utilisateur(s)`);

  // 5. Telegram : un seul message par utilisateur, les 6 plus gros mouvements
  let moverAlerts = 0;
  if (telegramToken) {
    for (const [u, list] of alertsByUser) {
      const chat = settingsMap.get(u)?.telegram_chat_id;
      if (!chat) continue;
      list.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
      const top = list.slice(0, 6);
      const text = '📊 Ta collection a bougé cette semaine :\n' + top.map(({ row, pct }) =>
        `${pct > 0 ? '📈' : '📉'} ${row.name} ${row.local_id || ''} : ${fr(Number(row.price7))} € → ${fr(Number(row.price))} € (${pct > 0 ? '+' : ''}${pct.toFixed(0)} %)${row.qty > 1 ? ` ×${row.qty}` : ''}`).join('\n');
      try {
        const r = await fetchImpl(`https://api.telegram.org/bot${telegramToken}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }) });
        if (!r.ok) continue;
        moverAlerts++;
        for (const { row } of top) await sb.from('movers').update({ alerted_at: now.toISOString() }).eq('user_id', u).eq('item', row.item);
      } catch { /* Telegram injoignable : on réessaiera demain */ }
    }
  }
  return { movers: rows.length, moverAlerts };
}

/** Alerte Telegram quand une carte de la wishlist apparaît dans les Opportunités. */
export async function wishDealAlerts({ sb, settingsMap, telegramToken, fetchImpl, now }) {
  if (!telegramToken) return { dealAlerts: 0 };
  const { data: wish, error } = await sb.from('wishlist').select('id,user_id,card_id,name,deal_alert_at');
  if (error) throw new Error(`Lecture wishlist : ${error.message}`);
  const ids = [...new Set((wish || []).map((w) => w.card_id))];
  const deals = new Map();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await sb.from('deals').select('card_id,name_fr,name,trend,avg30,drop_pct').in('card_id', ids.slice(i, i + 150));
    for (const r of data || []) deals.set(r.card_id, r);
  }
  let n = 0;
  const byUser = new Map();
  for (const w of wish || []) {
    const dl = deals.get(w.card_id);
    const chat = settingsMap.get(w.user_id)?.telegram_chat_id;
    if (!dl || !chat) continue;
    if (w.deal_alert_at && now - new Date(w.deal_alert_at) < ALERT_COOLDOWN_DAYS * 864e5) continue;
    if (!byUser.has(w.user_id)) byUser.set(w.user_id, { chat, list: [] });
    byUser.get(w.user_id).list.push({ w, dl });
  }
  for (const { chat, list } of byUser.values()) {
    const text = '💡 Opportunité sur ta wishlist :\n' + list.slice(0, 8).map(({ w, dl }) =>
      `${w.name} : ${fr(Number(dl.trend))} € (${String(dl.drop_pct).replace('.', ',')} % vs moyenne 30 j à ${fr(Number(dl.avg30))} €)`).join('\n');
    try {
      const r = await fetchImpl(`https://api.telegram.org/bot${telegramToken}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }) });
      if (!r.ok) continue;
      n++;
      await sb.from('wishlist').update({ deal_alert_at: now.toISOString() }).in('id', list.map((x) => x.w.id));
    } catch { /* on réessaiera demain */ }
  }
  return { dealAlerts: n };
}
