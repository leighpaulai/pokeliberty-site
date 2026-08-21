/**
 * Cart-page shipping preview — returns what Ground/Priority would cost (or
 * "free") for the cart as it stands right now, so shoppers see a real number
 * before they ever reach Stripe Checkout instead of a bare "calculated at
 * checkout." Intentionally thin: it re-uses shipping.js's priceForTier /
 * highestTier / FREE_SHIPPING_THRESHOLD_CENTS rather than recomputing
 * anything, so this can never drift from what create-checkout-session.js
 * actually charges. This is a preview only — the authoritative shipping
 * calculation for the real charge still happens in
 * create-checkout-session.js at the moment checkout is created.
 */
const products = require('./products-data.json');
const { priceForTier, highestTier, FREE_SHIPPING_THRESHOLD_CENTS } = require('./shipping');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const items = Array.isArray(payload.items) ? payload.items : [];

  let subtotalCents = 0;
  const shippingTiers = [];
  for (const item of items) {
    const product = products[item.id];
    if (!product || !product.active) continue; // stale/removed item — cart.js re-validates for display separately
    const qty = Math.max(0, Math.min(parseInt(item.quantity, 10) || 0, product.stock));
    if (qty <= 0) continue;
    subtotalCents += product.unit_amount * qty;
    shippingTiers.push(product.shipping_tier || 'medium');
  }

  const free = subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS;
  const tier = highestTier(shippingTiers.length ? shippingTiers : ['small']);
  const { ground, priority } = priceForTier(tier);

  return {
    statusCode: 200,
    body: JSON.stringify({
      subtotalCents,
      free,
      ground: free ? 0 : ground,
      priority: free ? 0 : priority,
    }),
  };
};
