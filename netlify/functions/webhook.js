/**
 * Stripe webhook — on a completed Checkout Session, decrements stock in the
 * "Poke Liberty Product Inventory" Google Sheet for whatever was purchased.
 *
 * The Sheet stays the source of truth; the site itself only catches up to a
 * decrement the next time scripts/build_products.py runs (scheduled every
 * 30 min, or triggered manually from the Actions tab) — so there can be a
 * lag between a sale and the storefront reflecting the new stock count.
 *
 * Not perfectly race-free under concurrent sales (read-then-write against
 * the Sheet, no locking) and not idempotent against duplicate webhook
 * deliveries (no processed-event store) — both acceptable trade-offs at
 * this shop's volume; flagged here rather than silently assumed.
 */
const Stripe = require('stripe');
const { JWT } = require('google-auth-library');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SHEET_ID = process.env.SHEET_ID;
const SHEETS_BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;

function getClient() {
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  return new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function decrementStock(purchasedItems) {
  const client = getClient();
  const { token } = await client.getAccessToken();
  const authHeader = { Authorization: `Bearer ${token}` };

  const getRes = await fetch(`${SHEETS_BASE}/values/A:Z`, { headers: authHeader });
  if (!getRes.ok) {
    throw new Error(`Sheets read failed: ${getRes.status}`);
  }
  const { values } = await getRes.json();
  if (!values || values.length < 2) return;

  const headers = values[0].map((h) => h.trim());
  const idCol = headers.indexOf('id');
  const stockCol = headers.indexOf('stock');
  if (idCol === -1 || stockCol === -1) {
    throw new Error('Sheet is missing an "id" or "stock" column');
  }

  const data = [];
  for (const { id, quantity } of purchasedItems) {
    const rowIndex = values.findIndex((row, i) => i > 0 && row[idCol] === id);
    if (rowIndex === -1) continue; // product no longer in the sheet — nothing to decrement

    const currentStock = parseInt(values[rowIndex][stockCol], 10) || 0;
    const newStock = Math.max(0, currentStock - quantity);
    const colLetter = String.fromCharCode('A'.charCodeAt(0) + stockCol);
    const rowNumber = rowIndex + 1; // 1-indexed for A1 notation

    data.push({
      range: `${colLetter}${rowNumber}`,
      values: [[newStock]],
    });
  }

  if (data.length === 0) return;

  const updateRes = await fetch(`${SHEETS_BASE}/values:batchUpdate`, {
    method: 'POST',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });
  if (!updateRes.ok) {
    throw new Error(`Sheets batchUpdate failed: ${updateRes.status}`);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const sig = event.headers['stripe-signature'];
  // Signature verification needs the exact raw bytes Stripe sent — if
  // Netlify delivered it base64-encoded, decode before verifying rather
  // than handing constructEvent the encoded string.
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const raw = session.metadata && session.metadata.cart_items;

    if (raw) {
      try {
        const purchasedItems = JSON.parse(raw);
        await decrementStock(purchasedItems);
      } catch (err) {
        // Log and 500 so Stripe retries — but don't throw synchronously
        // uncaught, since we still want a clean response either way.
        console.error('Failed to decrement stock:', err);
        return { statusCode: 500, body: JSON.stringify({ error: 'Stock decrement failed' }) };
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
