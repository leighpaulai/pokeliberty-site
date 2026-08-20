/* Poke Liberty — shared cart logic (index.html + cart.html)
 * Cart is stored client-side in localStorage as { [productId]: quantity }.
 * This is a convenience layer only — the server (Netlify function) always
 * re-validates price and stock against the sheet-generated product data
 * before creating a Stripe Checkout Session, so nothing here is trusted
 * for the actual charge.
 */
const CART_STORAGE_KEY = 'pokeliberty_cart';
const DONATION_STORAGE_KEY = 'pokeliberty_cart_donation';

// Kept in sync by hand with netlify/functions/shipping.js's
// FREE_SHIPPING_THRESHOLD_CENTS — this one drives the "spend $X more"
// nudge shown to shoppers, the server-side one is what's actually
// enforced at checkout. If you change the threshold, change both.
const FREE_SHIPPING_THRESHOLD_CENTS = 10000; // $100.00

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  updateCartBadge();
}

function addToCart(productId, quantity) {
  const cart = getCart();
  cart[productId] = (cart[productId] || 0) + quantity;
  saveCart(cart);
}

function setCartQuantity(productId, quantity) {
  const cart = getCart();
  if (quantity <= 0) {
    delete cart[productId];
  } else {
    cart[productId] = quantity;
  }
  saveCart(cart);
}

function removeFromCart(productId) {
  const cart = getCart();
  delete cart[productId];
  saveCart(cart);
}

function clearCart() {
  localStorage.removeItem(CART_STORAGE_KEY);
  localStorage.removeItem(DONATION_STORAGE_KEY);
  updateCartBadge();
}

function cartItemCount() {
  const cart = getCart();
  return Object.values(cart).reduce((sum, qty) => sum + qty, 0);
}

function updateCartBadge() {
  const badge = document.getElementById('cart-badge');
  if (!badge) return;
  const count = cartItemCount();
  badge.textContent = count > 0 ? String(count) : '';
  badge.dataset.count = String(count);
}

function getDonationPreference() {
  return localStorage.getItem(DONATION_STORAGE_KEY) === 'true';
}

function setDonationPreference(enabled) {
  localStorage.setItem(DONATION_STORAGE_KEY, enabled ? 'true' : 'false');
}

/* Wires the +/- buttons and manual entry on a quantity stepper, clamping
 * to [1, max] where max comes from the input's own max attribute (set per
 * product from its current stock). */
function wireQtyStepper(stepper) {
  const input = stepper.querySelector('[data-qty-input]');
  const decBtn = stepper.querySelector('[data-qty-decrement]');
  const incBtn = stepper.querySelector('[data-qty-increment]');
  if (!input) return;

  const max = parseInt(input.max, 10) || 99;
  const min = parseInt(input.min, 10) || 1;

  const clamp = () => {
    let val = parseInt(input.value, 10);
    if (isNaN(val)) val = min;
    val = Math.max(min, Math.min(max, val));
    input.value = val;
    if (decBtn) decBtn.disabled = val <= min;
    if (incBtn) incBtn.disabled = val >= max;
  };

  if (decBtn) decBtn.addEventListener('click', () => { input.value = (parseInt(input.value, 10) || min) - 1; clamp(); });
  if (incBtn) incBtn.addEventListener('click', () => { input.value = (parseInt(input.value, 10) || min) + 1; clamp(); });
  input.addEventListener('change', clamp);
  input.addEventListener('blur', clamp);
  clamp();
}

async function fetchProductsData() {
  const res = await fetch('data/products.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load product data');
  return res.json();
}

/** Current cart's merchandise subtotal in cents, using live prices/stock
 * from products.json rather than anything cached client-side — matches
 * what the server will actually charge, and self-corrects for stale
 * quantities (e.g. stock dropped below what's in someone's cart). */
async function getCartSubtotalCents() {
  const cart = getCart();
  const products = await fetchProductsData();
  let subtotal = 0;
  for (const [id, qty] of Object.entries(cart)) {
    const product = products[id];
    if (product && product.active) {
      subtotal += product.unit_amount * Math.min(qty, product.stock);
    }
  }
  return subtotal;
}

/** Fills a container with "Add $X more for free shipping!" (or an
 * unlocked message once the threshold is hit), based on the current
 * cart. Used on both the homepage product section and the cart page. */
async function renderFreeShippingProgress(containerEl) {
  if (!containerEl) return;
  try {
    const subtotal = await getCartSubtotalCents();
    const remaining = FREE_SHIPPING_THRESHOLD_CENTS - subtotal;
    if (remaining <= 0) {
      containerEl.textContent = "🎉 Your order qualifies for free shipping!";
      containerEl.classList.add('unlocked');
    } else {
      containerEl.textContent = `Add $${(remaining / 100).toFixed(2)} more to your cart for FREE shipping!`;
      containerEl.classList.remove('unlocked');
    }
    containerEl.hidden = false;
  } catch {
    containerEl.hidden = true;
  }
}
