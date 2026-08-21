/**
 * Order confirmation data for success.html — retrieves the completed
 * Checkout Session server-side (using STRIPE_SECRET_KEY, never exposed to
 * the client) and returns a minimal, safe-to-display subset: line items,
 * total paid, which shipping method was chosen, and any local-pickup note.
 *
 * Only returns data for a session that's actually paid/complete, so this
 * can't be used to probe arbitrary session IDs for someone else's order
 * details before payment finished.
 */
const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const sessionId = event.queryStringParameters && event.queryStringParameters.session_id;
  if (!sessionId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing session_id' }) };
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'shipping_cost.shipping_rate'],
    });

    if (session.payment_status !== 'paid' && session.status !== 'complete') {
      return { statusCode: 404, body: JSON.stringify({ error: 'Order not found' }) };
    }

    const items = (session.line_items?.data || []).map((li) => ({
      name: li.description,
      quantity: li.quantity,
      amount: li.amount_total,
    }));

    const shippingRate = session.shipping_cost && session.shipping_cost.shipping_rate;
    const shippingMethodName =
      shippingRate && typeof shippingRate === 'object' ? shippingRate.display_name : null;

    const pickupField = (session.custom_fields || []).find((f) => f.key === 'pickup_time');
    const pickupNote = pickupField && pickupField.text ? pickupField.text.value : null;

    return {
      statusCode: 200,
      body: JSON.stringify({
        items,
        amountTotal: session.amount_total,
        shippingAmount: session.shipping_cost ? session.shipping_cost.amount_total : null,
        shippingMethodName,
        pickupNote,
      }),
    };
  } catch (err) {
    console.error('Failed to retrieve order details:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load order details' }) };
  }
};
