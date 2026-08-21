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

/** Wires shop.html's category tabs + search + in-stock/out-of-stock filter
 * together over the already-rendered product grid (no server round-trip —
 * everything's already in the DOM). A card must match the active category,
 * search text, AND stock filter to show; a whole category-group hides when
 * nothing in it matches (or when a specific tab doesn't apply to it). Tab
 * buttons are built from each .category-group's data-category attribute,
 * so the tab bar always matches whatever categories the Sheet produced —
 * nothing here is hand-maintained per category name. */
function wireShopFilters({ shopSection, searchInput, stockFilter, categoryTabs, noResultsEl }) {
  if (!shopSection) return;
  const groups = [...shopSection.querySelectorAll('.category-group')];
  const categories = [...new Set(groups.map((g) => g.dataset.category))];
  let activeCategory = 'all';

  function applyFilter() {
    const query = (searchInput?.value || '').trim().toLowerCase();
    const stockValue = stockFilter ? stockFilter.value : 'all';
    let totalVisible = 0;

    groups.forEach((group) => {
      const groupMatchesCategory = activeCategory === 'all' || group.dataset.category === activeCategory;
      let groupVisible = 0;
      group.querySelectorAll('.product-card').forEach((card) => {
        const name = card.dataset.searchName || '';
        const inStock = card.dataset.inStock === 'true';
        const matchesQuery = !query || name.includes(query);
        const matchesStock =
          stockValue === 'all' ||
          (stockValue === 'in' && inStock) ||
          (stockValue === 'out' && !inStock);
        const visible = groupMatchesCategory && matchesQuery && matchesStock;
        card.hidden = !visible;
        if (visible) groupVisible++;
      });
      group.hidden = groupVisible === 0;
      totalVisible += groupVisible;
    });

    if (noResultsEl) noResultsEl.hidden = totalVisible > 0;
  }

  if (categoryTabs) {
    const makeTab = (label, value) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'category-tab' + (value === 'all' ? ' active' : '');
      btn.textContent = label;
      btn.dataset.category = value;
      btn.addEventListener('click', () => {
        activeCategory = value;
        categoryTabs.querySelectorAll('.category-tab').forEach((b) => b.classList.toggle('active', b === btn));
        applyFilter();
      });
      return btn;
    };
    categoryTabs.appendChild(makeTab('All', 'all'));
    categories.forEach((cat) => categoryTabs.appendChild(makeTab(cat, cat)));
  }

  if (searchInput) searchInput.addEventListener('input', applyFilter);
  if (stockFilter) stockFilter.addEventListener('change', applyFilter);
  applyFilter();
}

/** Sorts product-cards within each category-group by price or name, using
 * the numeric data-price (cents) / data-search-name attributes set on each
 * card — group membership and visibility stay under wireShopFilters, this
 * only reorders what's already showing. Leaving the select on its default
 * value keeps the Sheet-driven (i.e. "featured first") order untouched. */
function wireProductSort(sortSelect, shopSection) {
  if (!sortSelect || !shopSection) return;
  const comparators = {
    'price-asc': (a, b) => Number(a.dataset.price) - Number(b.dataset.price),
    'price-desc': (a, b) => Number(b.dataset.price) - Number(a.dataset.price),
    'name-asc': (a, b) => (a.dataset.searchName || '').localeCompare(b.dataset.searchName || ''),
  };
  sortSelect.addEventListener('change', () => {
    const comparator = comparators[sortSelect.value];
    if (!comparator) return;
    shopSection.querySelectorAll('.category-group').forEach((group) => {
      [...group.querySelectorAll('.product-card')].sort(comparator).forEach((card) => group.appendChild(card));
    });
  });
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

/** Fills a container with a preview of the three checkout shipping options
 * (Ground / Priority / Local Pickup) and their real prices, computed
 * server-side by the shipping-estimate function from the same formula
 * create-checkout-session.js uses — never duplicated client-side, since
 * getting this preview wrong would just train shoppers to distrust it.
 * Fails soft (hides itself) rather than block cart review over a preview. */
async function renderShippingPreview(containerEl, items) {
  if (!containerEl) return;
  if (!items.length) {
    containerEl.hidden = true;
    return;
  }
  try {
    const res = await fetch('/.netlify/functions/shipping-estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) throw new Error('Shipping estimate failed');
    const { ground, priority, free } = await res.json();
    containerEl.innerHTML = `
      <h3 class="shipping-preview-title">Shipping options at checkout</h3>
      <div class="shipping-option-row"><span>Ground Shipping <em>(2–5 business days)</em></span><span>${free ? 'FREE' : fmt(ground)}</span></div>
      <div class="shipping-option-row"><span>Priority Shipping <em>(1–3 business days)</em></span><span>${free ? 'FREE' : fmt(priority)}</span></div>
      <div class="shipping-option-row"><span>Local Pickup <em>(Kansas City area)</em></span><span>FREE</span></div>
      <p class="shipping-preview-note">You'll pick one of these at secure checkout — prices shown are estimates; the final amount is confirmed by Stripe based on your address.</p>
    `;
    containerEl.hidden = false;
  } catch {
    containerEl.hidden = true;
  }
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
