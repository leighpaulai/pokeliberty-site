# Liberty TCG / Poke Liberty — Project Notes

This file is read automatically by Claude Code at the start of every session.

## Business context
- Legal entity: Liberty TCG LLC (Missouri), dba "Poke Liberty"
- Sells Pokémon TCG sealed product, singles, grading-ready pulls
- pokeliberty.com — Kansas City / Liberty, MO area
- Payments: Stripe
- Fulfillment: USPS Ground Advantage + Priority Mail via Pirate Ship, packaging from Amazon Business, plus Local Pickup (KC area)

## Brand
- Colors: ink navy #0E1420, gold #C9A24B / #E4C878, parchment #F3EFE4, slate #7C879C, red #D6483C
- Fonts: Fraunces (headlines), Space Grotesk (body)

## Tech stack
- Static site (`index.html`, `cart.html`, `success.html`, `styles.css`, `cart.js`, `signup.js`) deployed on Netlify (`netlify.toml`: publish `.`, functions `netlify/functions`, bundled with esbuild)
- Backend logic lives entirely in Netlify Functions (`netlify/functions/`): `create-checkout-session.js`, `webhook.js`, `shipping.js`, `subscribe.js`
- Dependencies (`package.json`): `stripe` (^17), `google-auth-library` (^9) — no frontend framework/bundler, plain JS/DOM
- Inventory pipeline: `scripts/build_products.py` (Python, see `scripts/requirements.txt`) reads a Google Sheet ("Poke Liberty Product Inventory") and regenerates `netlify/functions/products-data.json` (server-side, trusted) and `data/products.json` (client-side, for display/cart rendering). Runs on a schedule via GitHub Actions (`.github/`) roughly every 30 min, or can be triggered manually — see recent "Sync inventory from Google Sheet [automated]" commits
- Cart state is client-side only, stored in `localStorage` (`cart.js`, key `pokeliberty_cart`) — a convenience layer never trusted for pricing/stock

## Stripe integration (cart.js / create-checkout-session.js / webhook.js / success.html)
- **Checkout creation** (`netlify/functions/create-checkout-session.js`): cart.html posts `{ items: [{id, quantity}], donation }` to `/.netlify/functions/create-checkout-session`. The function re-reads price, stock, and active status from `products-data.json` (never trusts client-submitted prices/quantities), builds Stripe Checkout `line_items` via `price_data`, adds an optional $1 "Climate Support Donation" line item, enables `automatic_tax`, collects a US shipping address, offers an optional custom field for local-pickup time, and creates a `stripe.checkout.sessions.create(...)` session in `mode: 'payment'`. Cart contents are also stashed in `session.metadata.cart_items` (JSON) so the webhook can later decrement the right stock rows. Redirects to `success_url: /success.html?session_id=...` or `cancel_url: /cart.html`.
- **Shipping** (`netlify/functions/shipping.js`): computes 3 `shipping_options` for the session — Ground (USPS Ground Advantage), Priority (USPS Priority, not flat-rate), and Local Pickup ($0 always). Price = (carrier rate + materials) × 1.10, rounded to nearest $0.05, using tiers `small`/`medium`/`large` per product (mixed cart uses the highest tier present). Both shipping options go free when merchandise subtotal ≥ $100 (`FREE_SHIPPING_THRESHOLD_CENTS`, duplicated by hand in `cart.js` for the UI nudge — must be kept in sync manually).
- **Webhook** (`netlify/functions/webhook.js`): listens for `checkout.session.completed`, verifies the Stripe signature (`STRIPE_WEBHOOK_SECRET`, handles Netlify's base64-encoded body), parses `cart_items` back out of session metadata, and decrements stock directly in the Google Sheet via the Sheets API (service account auth, `GOOGLE_SERVICE_ACCOUNT_KEY` + `SHEET_ID`). Explicitly documented as **not** idempotent against duplicate webhook deliveries and **not** race-free under concurrent sales (read-then-write, no locking) — accepted trade-off at current volume, not an oversight.
- **Post-purchase** (`success.html`): static thank-you page; on load it calls `clearCart()` from `cart.js` to empty localStorage. It does not currently verify the `session_id` against Stripe or display order details — purely a confirmation page pointing customers to email for pickup/shipping follow-up.
- Env vars required: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY`.

## Checkout flow status
End-to-end flow appears implemented and functionally wired together, not a stub:
- Add to cart → cart.html (live re-validation of price/stock/active against `data/products.json`, quantity clamping, free-shipping progress banner, optional $1 donation, optional "create account" signup capture) → Stripe Checkout Session (server-validated pricing/stock, tax, shipping options, address collection) → success.html (clears cart) → webhook decrements Sheet stock → next scheduled `build_products.py` run reflects the new stock on the storefront.
- Known accepted gaps (called out directly in code comments, not silently missing): webhook is not idempotent/race-free; stock sync has up-to-~30-min lag after a sale; shipping carrier rates in `shipping.js` are estimates flagged as "confirm against real weighed packages before going live"; success.html doesn't verify the session or show order contents.
- No automated test suite in the repo — verify checkout changes manually (e.g. Stripe test mode) before shipping.
