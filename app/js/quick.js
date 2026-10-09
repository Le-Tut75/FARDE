// Bouton « + » : ajoute un exemplaire à la collection en un clic, sans ouvrir de formulaire.
import { S, addCard, updateCard, addSealed, updateSealed } from './store.js';
import { getCard } from './tcgdex.js';
import { toast, today } from './ui.js';

/** Pastille « + » à placer dans le coin d'une vignette (dans un .img ou .simg en position relative). */
export const plusBtn = (label = 'Ajouter à ma collection') => `<span class="plus" role="button" tabindex="0" data-plus aria-label="${label}" title="${label}">+</span>`;

/**
 * Carte : +1 exemplaire Near Mint, version normale (ou la première version existante), dans la farde par défaut.
 * Si tu as déjà exactement cette ligne (même langue, version, état, non gradée, sans prix), on augmente sa quantité.
 */
export async function quickAddCard(lang, id, hint = {}) {
  const card = await getCard(lang, id).catch(() => null);
  const keys = card?.vd?.length ? [...new Set(card.vd.map((v) => v.key))] : card?.variants ? Object.keys(card.variants).filter((k) => card.variants[k]) : [];
  const variant = !keys.length || keys.includes('normal') ? 'normal' : keys[0];
  const same = S.cards.find((l) => l.lang === lang && l.card_id === id && l.variant === variant && l.condition === 'NM' && !l.grading_company && l.buy_price == null && l.manual_price == null && !l.expense_id);
  let line;
  if (same) line = await updateCard(same.id, { qty: same.qty + 1 });
  else {
    line = await addCard({
      lang, card_id: id, name: card?.name || hint.name || id, local_id: card?.localId ?? hint.localId ?? null, set_id: card?.set?.id || null, set_name: card?.set?.name || hint.setName || null,
      set_total: card?.set?.total ?? null, image: card?.image || hint.image || null, rarity: card?.rarity || null, variant, condition: 'NM', qty: 1,
      buy_price: null, buy_date: today(), binder_id: S.binders[0]?.id || null, source: 'manuel',
    });
  }
  const n = S.cards.filter((l) => l.lang === lang && l.card_id === id).reduce((a, l) => a + l.qty, 0);
  toast(`${line.name} ajoutée (×${n} au total).`, 6000, { label: 'Préciser prix, état…', onClick: () => import('./carddialog.js').then((m) => m.openCard(lang, id, { line: S.cards.find((l) => l.id === line.id) || line })) });
  return line;
}

/** Scellé du catalogue Cardmarket : +1 exemplaire, prix d'achat à préciser ensuite. */
export async function quickAddSealed(cm) {
  const lang = S.settings.default_lang || 'fr';
  const same = S.sealed.find((s) => Number(s.cm_id) === Number(cm.id) && s.lang === lang && s.buy_price == null && s.manual_price == null);
  const line = same ? await updateSealed(same.id, { qty: same.qty + 1 })
    : await addSealed({ cm_id: cm.id, name: cm.name, category: cm.category || null, lang, qty: 1, buy_price: null, buy_date: today() });
  toast(`${cm.name} ajouté (×${line.qty}).`, 6000, { label: 'Préciser le prix', onClick: () => import('./views/sealed.js').then((m) => m.openSealed(S.sealed.find((s) => s.id === line.id) || line)) });
  return line;
}

/**
 * Branche les « + » d'une grille : handler(el) reçoit la vignette.
 * Le clic sur « + » n'ouvre pas la fiche (on arrête l'événement avant).
 */
export function bindPlus(container, handler) {
  const run = async (e) => {
    const p = e.target.closest('[data-plus]'); if (!p || !container.contains(p)) return false;
    e.preventDefault(); e.stopPropagation();
    if (p.dataset.busy) return true;
    p.dataset.busy = '1'; p.classList.add('busy');
    try { await handler(p.closest('[data-id],[data-card],[data-k],[data-i],[data-open]'), p); p.classList.add('done'); setTimeout(() => p.classList.remove('done'), 900); }
    catch (err) { toast(err.message, 5000); }
    finally { delete p.dataset.busy; p.classList.remove('busy'); }
    return true;
  };
  container.addEventListener('click', run, true);
  container.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-plus]')) run(e); }, true);
}
