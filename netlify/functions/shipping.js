/**
 * Shipping price computation.
 *
 * Business rule: price = (carrier rate + materials cost) × 1.10, rounded to
 * the nearest $0.05. FREE shipping (both paid tiers) when cart subtotal >=
 * $100. Local Pickup is always $0 regardless of subtotal.
 *
 * Three fulfillment options at checkout:
 *   1. Standard (Ground)  — USPS Ground Advantage, weight/zone-based
 *   2. Fast (Priority)    — USPS Priority Mail, weight/zone-based —
 *                            NOT Flat Rate boxes (disproportionately
 *                            expensive for a single large item; revisit
 *                            only for large multi-item bulk orders)
 *   3. Local Pickup        — Kansas City area, $0, no carrier involved
 *
 * Carrier rates in RATE_TABLE are estimates (Pirate Ship discounted USPS
 * rates, rough midpoints — actual cost varies by shipping zone) — confirm
 * against real weighed packages before going live and update the numbers
 * there. Nothing else needs to change when you do; prices below are
 * computed from these raw inputs, not hardcoded, so a rate change is a
 * one-line edit.
 *
 * Tiers: "small" (single cards, slabs, small packs), "medium" (multiple
 * packs, small bundles), "large" (booster boxes, ETBs, poster
 * collections). A mixed-tier cart uses the largest tier present.
 */

const MARKUP = 1.10;
const FREE_SHIPPING_THRESHOLD_CENTS = 10000; // $100.00

const TIER_ORDER = ['small', 'medium', 'large'];

// All money in cents.
const RATE_TABLE = {
  small: { materials: 45, groundRate: 500, priorityRate: 900 },
  medium: { materials: 75, groundRate: 700, priorityRate: 1000 },
  large: { materials: 125, groundRate: 900, priorityRate: 1300 },
};

function roundToNearestNickel(cents) {
  return Math.round(cents / 5) * 5;
}

function priceForTier(tier) {
  const rates = RATE_TABLE[tier];
  if (!rates) {
    throw new Error(`Unknown shipping tier: ${tier}`);
  }
  return {
    ground: roundToNearestNickel((rates.groundRate + rates.materials) * MARKUP),
    priority: roundToNearestNickel((rates.priorityRate + rates.materials) * MARKUP),
  };
}

/** Highest tier present among the given shipping_tier values (defaults to
 * "small" for an empty list, which should never actually happen for a
 * non-empty cart). */
function highestTier(tiers) {
  return tiers.reduce((highest, tier) => {
    const tierIndex = TIER_ORDER.indexOf(tier);
    const highestIndex = TIER_ORDER.indexOf(highest);
    return tierIndex > highestIndex ? tier : highest;
  }, TIER_ORDER[0]);
}

/**
 * Builds the three-option Stripe `shipping_options` array for a cart:
 * Ground, Priority, and Local Pickup (always $0). subtotalCents must
 * exclude tax, shipping, and any donation line item — it's the actual
 * merchandise subtotal the $100 free-shipping rule applies to.
 */
function buildShippingOptions(subtotalCents, shippingTiers) {
  const free = subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS;
  const tier = highestTier(shippingTiers.length ? shippingTiers : ['small']);
  const { ground, priority } = priceForTier(tier);

  return [
    {
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: free ? 0 : ground, currency: 'usd' },
        display_name: free ? 'Free Ground Shipping' : 'Ground Shipping (2–5 business days)',
        delivery_estimate: {
          minimum: { unit: 'business_day', value: 2 },
          maximum: { unit: 'business_day', value: 5 },
        },
      },
    },
    {
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: free ? 0 : priority, currency: 'usd' },
        display_name: free ? 'Free Priority Shipping' : 'Priority Shipping (1–3 business days)',
        delivery_estimate: {
          minimum: { unit: 'business_day', value: 1 },
          maximum: { unit: 'business_day', value: 3 },
        },
      },
    },
    {
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: 0, currency: 'usd' },
        display_name: 'Local Pickup (Kansas City area)',
      },
    },
  ];
}

module.exports = {
  buildShippingOptions,
  priceForTier,
  highestTier,
  roundToNearestNickel,
  RATE_TABLE,
  FREE_SHIPPING_THRESHOLD_CENTS,
};
