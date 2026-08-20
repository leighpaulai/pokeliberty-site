/**
 * Creates a single Stripe Checkout Session for the customer's whole cart.
 *
 * Trusts nothing from the client except *which* product ids and quantities
 * were requested — every price and stock ceiling is re-read here from
 * products-data.json (regenerated from the Google Sheet by
 * scripts/build_products.py), so a tampered client request can't buy at a
 * wrong price or oversell inventory.
 *
 * Tax and the actual payment UI are deliberately left to Stripe
 * (automatic_tax + Checkout) rather than reimplemented here.
 */
const Stripe = require('stripe');
const products = require('./products-data.json');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const DONATION_AMOUNT_CENTS = 100;

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
  const donation = payload.donation === true;

  if (items.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Your cart is empty.' }) };
  }

  const line_items = [];
  // Tracks which internal product ids + quantities this session covers, so
  // the webhook can decrement the right rows in the Sheet after payment —
  // Stripe's ad-hoc price_data line items don't carry that back on their own.
  const purchasedItems = [];

  for (const item of items) {
    const product = products[item.id];
    if (!product || !product.active) {
      return { statusCode: 400, body: JSON.stringify({ error: `That item is no longer available.` }) };
    }

    const requestedQty = parseInt(item.quantity, 10);
    if (!Number.isInteger(requestedQty) || requestedQty < 1) {
      return { statusCode: 400, body: JSON.stringify({ error: `Invalid quantity for ${product.name}.` }) };
    }
    if (product.stock < 1) {
      return { statusCode: 409, body: JSON.stringify({ error: `${product.name} is sold out.` }) };
    }
    if (requestedQty > product.stock) {
      return { statusCode: 409, body: JSON.stringify({ error: `Only ${product.stock} left of ${product.name}.` }) };
    }

    line_items.push({
      price_data: {
        currency: 'usd',
        unit_amount: product.unit_amount,
        product_data: {
          name: product.name,
          description: product.description || undefined,
        },
      },
      quantity: requestedQty,
    });
    purchasedItems.push({ id: item.id, quantity: requestedQty });
  }

  if (donation) {
    line_items.push({
      price_data: {
        currency: 'usd',
        unit_amount: DONATION_AMOUNT_CENTS,
        product_data: { name: 'Climate Support Donation 🌱' },
      },
      quantity: 1,
    });
  }

  const domain = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://pokeliberty.com';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      automatic_tax: { enabled: true },
      shipping_address_collection: { allowed_countries: ['US'] },
      success_url: `${domain}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${domain}/cart.html`,
      metadata: {
        // Consumed by netlify/functions/webhook.js to decrement stock in
        // the Sheet once payment actually completes.
        cart_items: JSON.stringify(purchasedItems),
      },
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error('Stripe error creating checkout session:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not start checkout — please try again.' }) };
  }
};
