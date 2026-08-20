/**
 * Adds a signup (name, email, optional phone) to the "Poke Liberty
 * Subscribers" Google Sheet — used by both the homepage signup form and
 * the optional "keep me posted" prompt at checkout.
 *
 * De-dupes on email (case-insensitive) so submitting from both places
 * doesn't create duplicate rows.
 */
const { JWT } = require('google-auth-library');

const SHEET_ID = process.env.SUBSCRIBERS_SHEET_ID;
const RANGE = 'A:E';
const SHEETS_VALUES_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getClient() {
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  return new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

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

  // Honeypot field: left blank by real visitors, often filled in by bots.
  // Report success without writing anything so bots don't learn to skip it.
  if (payload.website) {
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  const name = (payload.name || '').trim();
  const email = (payload.email || '').trim().toLowerCase();
  const phone = (payload.phone || '').trim();
  const source = (payload.source || 'unknown').trim();

  if (!name || !email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Name and email are required.' }) };
  }
  if (!EMAIL_RE.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please enter a valid email address.' }) };
  }

  try {
    const client = getClient();
    const { token } = await client.getAccessToken();
    const authHeader = { Authorization: `Bearer ${token}` };

    const getRes = await fetch(SHEETS_VALUES_URL, { headers: authHeader });
    if (!getRes.ok) {
      throw new Error(`Sheets read failed: ${getRes.status}`);
    }
    const getData = await getRes.json();
    const rows = getData.values || [];
    const alreadySubscribed = rows
      .slice(1) // skip header row
      .some((row) => (row[1] || '').trim().toLowerCase() === email);

    if (!alreadySubscribed) {
      const appendRes = await fetch(`${SHEETS_VALUES_URL}:append?valueInputOption=RAW`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: [[name, email, phone, source, new Date().toISOString()]],
        }),
      });
      if (!appendRes.ok) {
        throw new Error(`Sheets append failed: ${appendRes.status}`);
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, alreadySubscribed }) };
  } catch (err) {
    console.error('Error saving subscriber:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not save your signup — please try again.' }) };
  }
};
