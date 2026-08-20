/* Poke Liberty — shared signup-form wiring, used on index.html (homepage
 * section) and cart.html (checkout prompt). Posts to the subscribe
 * Netlify function; the function itself owns validation + de-duping. */

function submitSignup({ name, email, phone, source, honeypot }) {
  return fetch('/.netlify/functions/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, phone, source, website: honeypot || '' }),
  }).then(async (res) => {
    let data = {};
    try { data = await res.json(); } catch { /* ignore unparsable body */ }
    if (!res.ok) {
      throw new Error(data.error || 'Something went wrong — please try again.');
    }
    return data;
  });
}

/* Wires a <form> with fields [data-signup-name], [data-signup-email],
 * [data-signup-phone] (optional), a submit button, and a status element
 * [data-signup-status]. `source` tags where the signup came from. */
function wireSignupForm(form, source) {
  if (!form) return;
  const statusEl = form.querySelector('[data-signup-status]');
  const submitBtn = form.querySelector('[type="submit"]');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = form.querySelector('[data-signup-name]').value.trim();
    const email = form.querySelector('[data-signup-email]').value.trim();
    const phoneEl = form.querySelector('[data-signup-phone]');
    const phone = phoneEl ? phoneEl.value.trim() : '';
    const honeypotEl = form.querySelector('[data-signup-honeypot]');
    const honeypot = honeypotEl ? honeypotEl.value.trim() : '';

    if (!name || !email) {
      statusEl.textContent = 'Please enter your name and email.';
      statusEl.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Signing up…';
    statusEl.hidden = true;

    submitSignup({ name, email, phone, source, honeypot })
      .then(() => {
        statusEl.textContent = "You're on the list! 🎉";
        statusEl.hidden = false;
        form.reset();
      })
      .catch((err) => {
        statusEl.textContent = err.message;
        statusEl.hidden = false;
      })
      .finally(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      });
  });
}
