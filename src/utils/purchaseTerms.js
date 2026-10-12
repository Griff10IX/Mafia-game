import api from './api';

export const PURCHASE_TERMS_TEXT =
  'Before you pay:\n\n' +
  '• This is a digital in-game item. It is delivered to your account straight away.\n' +
  '• Purchases are non-refundable once delivered.\n' +
  '• You agreed to the game rules when you joined. Breaking them (including selling points or items for real money) can lead to a ban without refund.\n' +
  '• Chargebacks lead to the purchased items, and anything bought with them, being removed.\n\n' +
  'Press OK to agree and continue to payment.';

/** Ask the buyer to agree to the purchase terms, then start Stripe checkout. Returns null if they decline. */
export async function startCheckout(body) {
  if (!window.confirm(PURCHASE_TERMS_TEXT)) return null;
  return api.post('/payments/checkout', { ...body, accept_terms: true });
}
