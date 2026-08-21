# Shipping spec

This is the durable spec for how Poke Liberty prices and presents shipping.
The actual source of truth for the math is
[`netlify/functions/shipping.js`](netlify/functions/shipping.js) — if this
doc and that file ever disagree, the code wins and this doc is out of date
and should be fixed to match.

## Pricing formula

```
price = (carrier rate + materials cost) × 1.10, rounded to the nearest $0.05
```

- **Markup**: 10% (`MARKUP = 1.10` in `shipping.js`)
- **Rounding**: nearest nickel (`roundToNearestNickel`)
- **Free shipping**: both paid tiers (Ground and Priority) become $0 once
  the cart's merchandise subtotal — excluding tax, shipping, and any
  donation line item — reaches **$100.00**
  (`FREE_SHIPPING_THRESHOLD_CENTS = 10000`). Local Pickup is always $0
  regardless of subtotal.

## Fulfillment options offered at checkout

Three `shipping_options` are always presented together in one Stripe
Checkout step (per checkout UX research — showing all fulfillment methods
side by side, rather than making the customer navigate back and forth,
reduces friction):

1. **Ground** — USPS Ground Advantage, weight/zone-based, 2–5 business days
2. **Priority** — USPS Priority Mail, weight/zone-based, 1–3 business days
   (not Flat Rate boxes — disproportionately expensive for a single large
   item; revisit only for large multi-item bulk orders)
3. **Local Pickup** — Kansas City area, always $0, no carrier involved.
   Labeled explicitly `Local Pickup — Free (Kansas City area)` rather than
   relying on shoppers to infer "free" from a $0 amount next to two paid
   options.

Stripe Checkout converts each option's `delivery_estimate` (business-day
range) into an actual delivery date shown to the customer — no extra work
needed on our end for that.

## Shipping tiers

Every product has a `shipping_tier` of `small`, `medium`, or `large`,
set per-row in the Sheet:

| Tier | Used for |
|---|---|
| `small` | Single cards, slabs, small packs |
| `medium` | Multiple packs, small bundles |
| `large` | Booster boxes, ETBs, poster collections |

A mixed-tier cart is priced at the **highest** tier present
(`highestTier()`). A row with no `shipping_tier` set, or an unrecognized
value, defaults to `medium` and prints a build-time warning — silently
under-charging shipping on a `large` item is worse than a wrong middle
guess, so this is a deliberate fail-safe-ish default, not silently ignored.

## Rate table (raw inputs — all money in cents)

```js
{
  small:  { materials: 45,  groundRate: 500, priorityRate: 900 },
  medium: { materials: 75,  groundRate: 700, priorityRate: 1000 },
  large:  { materials: 125, groundRate: 900, priorityRate: 1300 },
}
```

These are estimates (Pirate Ship discounted USPS rates, rough zone
midpoints) — **confirm against real weighed packages before going live**
and update the numbers here. Nothing else needs to change when you do;
every displayed/charged price is computed from these raw inputs, not
hardcoded, so a rate change is a one-line edit in `RATE_TABLE`.

## Where this logic is used

- **`netlify/functions/create-checkout-session.js`** — the authoritative
  calculation. Reads each cart item's real price/stock/tier from
  `products-data.json` server-side, then calls `buildShippingOptions()` to
  build the actual `shipping_options` Stripe charges from. This is the only
  place the real charge is ever computed.
- **`netlify/functions/shipping-estimate.js`** — a thin preview-only wrapper
  around the same `priceForTier`/`highestTier`/`FREE_SHIPPING_THRESHOLD_CENTS`
  exports, called by `cart.js` so the cart page can show real Ground/Priority
  numbers (or "FREE") before the customer ever reaches Stripe Checkout,
  instead of a bare "calculated at checkout." It never recomputes or
  duplicates the formula — it imports the same functions the real charge
  uses, so the preview can't drift from what's actually charged.
- **`cart.js` / `cart.html`** — separately hardcodes just the *threshold*
  (`FREE_SHIPPING_THRESHOLD_CENTS = 10000`) to drive the "spend $X more"
  progress banner shown on the homepage and cart page, since that's a pure
  UI nudge and doesn't need a round trip. **If you change the threshold,
  change it in both `shipping.js` and `cart.js`.**

## Change history

- Initial version written from the already-shipped `shipping.js` logic
  during the checkout/browsing UX overhaul (Aug 2026) — no pricing formula
  changed, only the Local Pickup label wording and the addition of the
  cart-page preview endpoint above.
