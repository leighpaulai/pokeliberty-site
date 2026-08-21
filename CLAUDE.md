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
- Static site (`index.html`, `shop.html`, `product.html`, `cart.html`, `success.html`, `styles.css`, `cart.js`, `signup.js`) deployed on Netlify (`netlify.toml`: publish `.`, functions `netlify/functions`, bundled with esbuild)
- Backend logic lives entirely in Netlify Functions (`netlify/functions/`): `create-checkout-session.js`, `webhook.js`, `shipping.js`, `shipping-estimate.js`, `get-order-details.js`, `subscribe.js`
- Dependencies (`package.json`): `stripe` (^17), `google-auth-library` (^9) — no frontend framework/bundler, plain JS/DOM
- Inventory pipeline: `scripts/build_products.py` (Python, see `scripts/requirements.txt`) reads a Google Sheet ("Poke Liberty Product Inventory") and regenerates the full product grid in `shop.html`, the Featured strip in `index.html`, `netlify/functions/products-data.json` (server-side, trusted), and `data/products.json` (client-side, for display/cart rendering). Runs on a schedule via GitHub Actions (`.github/`) roughly every 30 min, or can be triggered manually — see recent "Sync inventory from Google Sheet [automated]" commits
- Sheet columns: `id, category, name, description, price, stock, image_filename, active, shipping_tier, condition, featured` — `condition` (e.g. "Near Mint") and `featured` (TRUE/FALSE, controls the homepage strip) are both optional
- Cart state is client-side only, stored in `localStorage` (`cart.js`, key `pokeliberty_cart`) — a convenience layer never trusted for pricing/stock

## Stripe integration (cart.js / create-checkout-session.js / webhook.js / success.html)
- **Checkout creation** (`netlify/functions/create-checkout-session.js`): cart.html posts `{ items: [{id, quantity}], donation }` to `/.netlify/functions/create-checkout-session`. The function re-reads price, stock, and active status from `products-data.json` (never trusts client-submitted prices/quantities), builds Stripe Checkout `line_items` via `price_data`, adds an optional $1 "Climate Support Donation" line item, enables `automatic_tax`, collects a US shipping address, offers an optional custom field for local-pickup time, and creates a `stripe.checkout.sessions.create(...)` session in `mode: 'payment'`. Cart contents are also stashed in `session.metadata.cart_items` (JSON) so the webhook can later decrement the right stock rows. Redirects to `success_url: /success.html?session_id=...` or `cancel_url: /cart.html`.
- **Shipping** (`netlify/functions/shipping.js`): computes 3 `shipping_options` for the session — Ground (USPS Ground Advantage), Priority (USPS Priority, not flat-rate), and Local Pickup ($0 always). Price = (carrier rate + materials) × 1.10, rounded to nearest $0.05, using tiers `small`/`medium`/`large` per product (mixed cart uses the highest tier present). Both shipping options go free when merchandise subtotal ≥ $100 (`FREE_SHIPPING_THRESHOLD_CENTS`, duplicated by hand in `cart.js` for the UI nudge — must be kept in sync manually).
- **Webhook** (`netlify/functions/webhook.js`): listens for `checkout.session.completed`, verifies the Stripe signature (`STRIPE_WEBHOOK_SECRET`, handles Netlify's base64-encoded body), parses `cart_items` back out of session metadata, and decrements stock directly in the Google Sheet via the Sheets API (service account auth, `GOOGLE_SERVICE_ACCOUNT_KEY` + `SHEET_ID`). Explicitly documented as **not** idempotent against duplicate webhook deliveries and **not** race-free under concurrent sales (read-then-write, no locking) — accepted trade-off at current volume, not an oversight.
- **Post-purchase** (`success.html`): static thank-you page; on load it calls `clearCart()` from `cart.js` to empty localStorage. It does not currently verify the `session_id` against Stripe or display order details — purely a confirmation page pointing customers to email for pickup/shipping follow-up.
- Env vars required: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY`.

## Checkout flow status
End-to-end flow appears implemented and functionally wired together, not a stub:
- Browse (`index.html` Featured strip or `shop.html` full catalog with category tabs/search/sort/stock filter) → product.html (image, price, stock/urgency badge, condition badge when set, description, shipping-tier note) → Add to cart → cart.html (live re-validation of price/stock/active against `data/products.json`, quantity clamping, free-shipping progress banner, real Ground/Priority shipping-cost preview via `shipping-estimate.js`, optional $1 donation, optional "create account" signup capture) → Stripe Checkout Session (server-validated pricing/stock, tax, shipping options, address collection) → success.html (clears cart, shows a real order summary — items, total, shipping method, pickup note — via `get-order-details.js`) → webhook decrements Sheet stock → next scheduled `build_products.py` run reflects the new stock on the storefront.
- Known accepted gaps (called out directly in code comments, not silently missing): webhook is not idempotent/race-free; stock sync has up-to-~30-min lag after a sale; shipping carrier rates in `shipping.js` are estimates flagged as "confirm against real weighed packages before going live".
- No automated test suite in the repo — verify checkout changes manually (e.g. Stripe test mode) before shipping.

## Current status
As of the Aug 2026 checkout/browsing UX overhaul:
- **Browsing journey** is homepage (marketing + manually-curated Featured strip) → `shop.html` (full catalog: category tabs, search, stock filter, sort) → `product.html` (per-item detail page) → `cart.html` → Stripe Checkout → `success.html`. Previously the homepage held the entire catalog inline with no per-product page.
- **Cart page** now previews real shipping costs (Ground/Priority/Local Pickup) before handoff to Stripe, via a new `shipping-estimate.js` function — previously it only said "Calculated at checkout" for both tax and shipping.
- **Order confirmation** now shows an actual order summary (items, total paid, shipping method, pickup note) via a new `get-order-details.js` function reading the completed Stripe Checkout Session — previously it was generic thank-you copy only.
- **Product schema** gained optional `condition` and `featured` Sheet columns (see Tech stack above); both are no-ops for existing sealed-product rows until filled in.
- See `shipping-spec.md` for the full shipping pricing/tier spec (written from `shipping.js`, which stays the source of truth).
- Not yet done / open for later: no automated tests exist for any of this — the plan above was verified by code review only, not a live Stripe test-mode run; confirm that manually before relying on it in production.

## Session log
- **2026-08-20** — Checkout + browsing UX overhaul. Researched checkout patterns (Shopify/Baymard/TCGplayer) and TCG browsing patterns (TCGplayer, Troll and Toad); split the homepage into marketing + Featured strip with a new dedicated `shop.html` (categories/search/sort/filter) and `product.html` (detail page); added a cart-page shipping-cost preview and a real order-confirmation summary; added optional `condition`/`featured` product fields; wrote `shipping-spec.md`. No shipping pricing formula changed — only the Local Pickup label wording. See git log for the full commit.
