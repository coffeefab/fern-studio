# Booqable Checkout Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing "Checkout · pay deposit" button in `shop.html` to hand the cart off to Booqable's hosted checkout, deleting the dead Stripe Elements code and adding a thank-you landing page.

**Architecture:** Static GitHub Pages site posts cart contents to Booqable's cart API with the existing public `BOOQABLE_KEY`, receives a hosted checkout URL, and redirects the customer to Booqable. Booqable's hosted page collects customer info, charges 25% deposit via the already-connected Stripe account, and redirects back to `thank-you.html`. No new backend.

**Tech Stack:** Vanilla HTML/CSS/JS, Booqable REST API, Stripe (via Booqable's connection only), GitHub Pages hosting.

**Spec:** `docs/2026-05-19-booqable-checkout-handoff-design.md`

---

## Task 1: Pin down the exact Booqable cart-handoff API call

**Files:** none (research)

This project is vanilla HTML with no test framework, and Booqable has two
API generations (v1 + Boomerang). Before changing code, lock in the exact
endpoint, request shape, and the field that contains the redirect URL.

- [ ] **Step 1: Read Booqable's developer docs for cart creation**

Use WebFetch on `https://developers.booqable.com/` and follow the path for
"creating a cart" or "checkout API". Goal: find the endpoint that creates
a cart with line items and returns a customer-facing checkout URL.

Capture:
- Exact endpoint URL (e.g. `POST /api/1/carts` or `POST /api/boomerang/carts`)
- Required headers (auth via `api_key` query param, or `Authorization` header)
- Request body JSON shape, including how to attach line items with a `start_at` / `stop_at` date range and quantities
- Response field that holds the customer-facing checkout URL (likely `attributes.checkout_url`, `checkout_url`, or a `cart_token` you append to a known URL pattern)

- [ ] **Step 2: Record findings in this plan**

Append a "Booqable API reference" section at the bottom of this file with
the exact endpoint, payload skeleton, and response field name. Future tasks
reference this section by name instead of guessing.

- [ ] **Step 3: Commit research notes**

```bash
git add docs/2026-05-19-booqable-checkout-handoff-plan.md
git commit -m "Research Booqable cart-handoff API endpoints"
```

---

## Task 2: Verify the API call with curl using a real product

**Files:** none (verification)

Before touching `shop.html`, prove the API actually works against Erika's
live Booqable account with the products that are really in there.

- [ ] **Step 1: Get a real product ID from the live catalog**

Run:

```bash
curl -sS "https://byfernstudio.booqable.com/api/1/product_groups?api_key=28eab158038f0ce7e4662ddb9ea9b33c1caa9130e0134cf3e3e021f94bfc945a&per_page=3" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps([{'id':p['id'],'name':p['name'],'slug':p.get('slug')} for p in d.get('product_groups',d.get('data',[]))][:3], indent=2))"
```

Expected: at least one `{id, name, slug}` entry. Save one `id` for the next step.

- [ ] **Step 2: Create a cart via the endpoint identified in Task 1**

Using the endpoint and payload shape from Task 1's "Booqable API reference"
section, run a curl that creates a cart with one line item (qty 1, dates
two weeks out for start/stop). The response should include a
customer-facing checkout URL.

Expected: HTTP 200/201 with a JSON body containing the URL field identified
in Task 1.

- [ ] **Step 3: Open the URL in a browser and verify it loads Booqable's checkout**

The URL should show the Fern Studio Booqable cart with the line item we
just added. If Stripe is in test mode in Booqable, the checkout form
should be functional. Do not submit a real payment yet.

- [ ] **Step 4: Commit nothing**

Verification only — no code change to commit. If Step 2 or 3 fails,
return to Task 1 and re-check the API shape.

---

## Task 3: Wire the "Checkout · pay deposit" button to call Booqable and redirect

**Files:**
- Modify: `/Users/eespinoz/fern-studio/shop.html` (the click handler around line 1476)

- [ ] **Step 1: Locate the existing handler**

The existing handler at `shop.html:1476` currently moves the user from
cart step 1 to step 2 (the in-page customer-details step). Read the
existing 5 lines:

```js
document.getElementById('cartCheckoutBtn').addEventListener('click', () => {
  if (!cart.length) return;
  const sd = document.getElementById('shopDate').value;
  if (sd) document.getElementById('coDate').value = sd;
  const today2 = new Date().toISOString().split('T')[0];
  document.getElementById('coDate').min = today2;
  goStep(2);
});
```

- [ ] **Step 2: Replace with a Booqable handoff**

Replace the handler with the version below. **`BOOQABLE_CART_URL`,
the request body shape, and the response URL field must match what
Task 1 documented in the "Booqable API reference" section of this plan.**

The example below uses the v1 cart pattern as a placeholder skeleton —
swap in the real values from Task 1 before saving.

```js
document.getElementById('cartCheckoutBtn').addEventListener('click', async () => {
  if (!cart.length) return;

  const btn = document.getElementById('cartCheckoutBtn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Redirecting to checkout…';

  // Determine rental date range. Use the date in the shop's avail-check bar
  // if set, otherwise default to "today + 1" through "today + rentalDays".
  const today = new Date();
  const startDate = (document.getElementById('shopDate').value)
    ? new Date(document.getElementById('shopDate').value)
    : new Date(today.getTime() + 86400000);
  const stopDate = new Date(startDate.getTime() + rentalDays * 86400000);
  const toISO = d => d.toISOString();

  // Body shape from Task 1's Booqable API reference section.
  const body = {
    cart: {
      starts_at: toISO(startDate),
      stops_at:  toISO(stopDate),
      lines_attributes: cart.map(i => ({
        item_id:  i.id,
        quantity: i.qty,
      })),
    },
  };

  try {
    const res = await fetch(
      `https://byfernstudio.booqable.com/api/1/carts?api_key=${BOOQABLE_KEY}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body:    JSON.stringify(body),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || data?.message || `Booqable returned HTTP ${res.status}`);
    }
    // Field name from Task 1's API reference. Common candidates:
    //   data.cart.checkout_url  |  data.cart.url  |  data.checkout_url
    const checkoutUrl = data?.cart?.checkout_url || data?.checkout_url || data?.cart?.url;
    if (!checkoutUrl) {
      throw new Error('No checkout URL returned from Booqable');
    }

    // Clear local cart so a back-button visit starts fresh.
    cart = [];
    saveCart();

    window.location.href = checkoutUrl;
  } catch (err) {
    console.error('Booqable checkout handoff failed:', err);
    let errBox = document.getElementById('cartError');
    if (!errBox) {
      errBox = document.createElement('div');
      errBox.id = 'cartError';
      errBox.style.cssText = 'background:#fdecec;border:1px solid #e6b3b3;color:#8a2a2a;padding:.75rem 1rem;border-radius:6px;font-size:.82rem;margin:.6rem 0;line-height:1.5;text-align:left';
      btn.parentNode.insertBefore(errBox, btn);
    }
    errBox.textContent = `We could not start checkout (${err.message}). Please try again, or email byfernstudio@gmail.com.`;
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
});
```

- [ ] **Step 3: Open the page in a browser and submit a real cart**

```bash
open /Users/eespinoz/fern-studio/shop.html
```

Add a product, hit "Checkout · pay deposit". Confirm the page redirects
to a Booqable URL with the right product loaded. Open DevTools Network
tab to see the POST request and its response if anything goes wrong.

- [ ] **Step 4: Commit**

```bash
git add shop.html
git commit -m "Wire cart checkout to Booqable hosted checkout"
```

---

## Task 4: Move the delivery yes/no into cart Step 1 footer

**Files:**
- Modify: `/Users/eespinoz/fern-studio/shop.html` (Step 1 footer + Step 2 HTML)

The current flow puts the delivery toggle inside Step 2 of the cart
drawer (which we're about to delete in Task 5). Move it into the Step 1
footer so the deposit total can reflect delivery, and so the customer
makes that choice before the handoff.

- [ ] **Step 1: Find the existing Step 2 delivery block**

In `shop.html`, locate the `<div id="coDelivery">` block (the yes/no
buttons currently in Step 2). Read its markup.

- [ ] **Step 2: Insert an equivalent toggle into the cart footer**

In the `cart-footer` div (around `shop.html:581`), add a delivery row
above the "Subtotal" row:

```html
<div class="cart-delivery-row">
  <span class="cart-days-lbl">Need delivery?</span>
  <div class="cart-yn-ctrl" id="cartDeliveryToggle">
    <button type="button" class="cart-yn-btn" data-val="yes">Yes ($40)</button>
    <button type="button" class="cart-yn-btn" data-val="no">Pickup</button>
  </div>
</div>
```

Add minimal CSS in the existing `<style>` block:

```css
.cart-delivery-row{display:flex;align-items:center;justify-content:space-between;padding:.4rem 0;gap:.6rem}
.cart-yn-ctrl{display:flex;gap:.35rem}
.cart-yn-btn{padding:.3rem .7rem;border:1.5px solid rgba(28,27,20,.15);border-radius:2rem;background:none;font-size:.72rem;color:var(--stone);cursor:pointer;transition:all var(--t);font-family:'Jost',sans-serif}
.cart-yn-btn:hover{border-color:var(--sage);color:var(--sage)}
.cart-yn-btn.active{background:var(--sage);border-color:var(--sage);color:var(--ivory)}
```

- [ ] **Step 3: Hook the toggle to existing `checkoutDelivery` state**

Add the handler near the cart event-wiring block:

```js
document.getElementById('cartDeliveryToggle').addEventListener('click', e => {
  const btn = e.target.closest('.cart-yn-btn');
  if (!btn) return;
  document.querySelectorAll('#cartDeliveryToggle .cart-yn-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  checkoutDelivery = btn.dataset.val === 'yes';
  updateFooter();
});
```

`checkoutDelivery` is already declared globally and `updateFooter()`
already reads it to compute totals.

- [ ] **Step 4: Block checkout until delivery has been chosen**

Modify the new handler from Task 3, Step 2, to short-circuit if
`checkoutDelivery === null`:

```js
if (checkoutDelivery === null) {
  const ctrl = document.getElementById('cartDeliveryToggle');
  ctrl.style.outline = '2px solid var(--err)';
  setTimeout(() => ctrl.style.outline = '', 2500);
  return;
}
```

Insert this block just after the `if (!cart.length) return;` line.

- [ ] **Step 5: Pass delivery choice to Booqable as a line item**

In the same handler, append a delivery line item to the `lines_attributes`
array when `checkoutDelivery === true`. Use the product ID of the
"delivery" product in Booqable (the `shop.html` code already references
a `delivery` slug in `SKIP_SLUGS`, so the product exists in Booqable).
Fetch its real ID first:

```bash
curl -sS "https://byfernstudio.booqable.com/api/1/product_groups?api_key=$KEY&filter[slug]=delivery" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['product_groups'][0]['id'])"
```

Then in the body builder:

```js
const lines = cart.map(i => ({ item_id: i.id, quantity: i.qty }));
if (checkoutDelivery === true) {
  lines.push({ item_id: '<DELIVERY_PRODUCT_ID_FROM_CURL_ABOVE>', quantity: 1 });
}
// ...then in body:
lines_attributes: lines,
```

- [ ] **Step 6: Test in browser**

Add an item, pick "Yes ($40)", click checkout, verify the Booqable cart
shows both the item and the delivery line. Repeat with "Pickup", verify
only the item is in the Booqable cart.

- [ ] **Step 7: Commit**

```bash
git add shop.html
git commit -m "Move delivery choice into cart footer, pass to Booqable as line item"
```

---

## Task 5: Delete dead Stripe Elements code and Steps 2-3-4 of the cart drawer

**Files:**
- Modify: `/Users/eespinoz/fern-studio/shop.html`

These exist as leftover scaffolding from an abandoned custom-Stripe
attempt. They are unreachable now that Step 1's checkout button goes
straight to Booqable.

- [ ] **Step 1: Delete the Stripe.js script tag**

In `shop.html:10`, remove:

```html
<script src="https://js.stripe.com/v3/"></script>
```

- [ ] **Step 2: Delete the Stripe placeholder constants**

In `shop.html` around lines 731-733, remove:

```js
// ===== STRIPE KEY (replace with yours) =====
// Get your key at dashboard.stripe.com/apikeys → Publishable key
const STRIPE_PK = 'pk_live_YOUR_STRIPE_PUBLISHABLE_KEY';
```

And around lines 747-748:

```js
let stripeObj = null;
let stripeCard = null;
```

- [ ] **Step 3: Delete Step 2 HTML (customer-details step)**

In `shop.html` around the area before line 547, locate the `<div id="csStep2">`
block (the section containing the customer name/email/phone/date inputs
ending with `<button class="cart-cta-btn" id="toPayment">`). Delete the
entire `<div id="csStep2">…</div>` block.

- [ ] **Step 4: Delete Step 3 HTML (Stripe payment step)**

In `shop.html` around lines 551-566, delete the entire `<div id="csStep3">`
block (the section with `stripe-card-element`, `payBtn`, and "Pay deposit").

- [ ] **Step 5: Delete Step 4 HTML (confirmation step)**

In `shop.html` around lines 568-576, delete the entire `<div id="csStep4">`
block. Booqable's hosted checkout replaces this, and our new
`thank-you.html` page (Task 6) handles the post-payment landing.

- [ ] **Step 6: Delete the now-orphaned step navigation JS**

Remove these handlers (they reference deleted IDs):

```js
document.getElementById('backToCart').addEventListener('click', () => goStep(1));
document.getElementById('backToDetails').addEventListener('click', () => goStep(2));
document.getElementById('coPills').addEventListener('click', ...);
document.getElementById('coDelivery').addEventListener('click', ...);
document.getElementById('toPayment').addEventListener('click', ...);
document.getElementById('cartDoneBtn').addEventListener('click', ...);
```

Also remove the `goStep` function if it's only used by the deleted blocks.
Verify with a grep before deleting:

```bash
grep -n "goStep" /Users/eespinoz/fern-studio/shop.html
```

If `goStep` only appears in the soon-to-be-deleted handlers and its own
definition, delete it. If it's used elsewhere, leave it alone.

- [ ] **Step 7: Verify the page still loads with no JS errors**

```bash
open /Users/eespinoz/fern-studio/shop.html
```

Open DevTools console. Confirm there are zero red errors. The cart
drawer should open, accept items, and offer a single checkout button
that hands off to Booqable.

- [ ] **Step 8: Commit**

```bash
git add shop.html
git commit -m "Delete dead Stripe Elements code and unreachable cart steps 2-4"
```

---

## Task 6: Create `thank-you.html`

**Files:**
- Create: `/Users/eespinoz/fern-studio/thank-you.html`

Customer lands here after Booqable processes the deposit.

- [ ] **Step 1: Write the page**

Create `/Users/eespinoz/fern-studio/thank-you.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Thank You · Fern Studio Event Rentals</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500&family=Jost:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{
    --forest:#383410;--sage:#4A5C40;--ivory:#F7F4EF;--cream:#EDE8DF;
    --gold:#B5924A;--stone:#6B6358;--mist:#B0A898;--charcoal:#1C1B14;
  }
  body{font-family:'Jost',sans-serif;font-weight:300;color:var(--charcoal);background:var(--ivory);line-height:1.65;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}
  .ty-wrap{max-width:560px;text-align:center}
  .ty-mark{width:80px;height:80px;border-radius:50%;background:var(--sage);color:var(--ivory);display:flex;align-items:center;justify-content:center;font-size:2.2rem;margin:0 auto 1.8rem;box-shadow:0 8px 24px rgba(74,92,64,.22)}
  .ty-eyebrow{font-size:.7rem;letter-spacing:.22em;text-transform:uppercase;color:var(--gold);margin-bottom:1rem;font-weight:500}
  .ty-title{font-family:'Cormorant Garamond',serif;font-size:clamp(2.2rem,5vw,3rem);color:var(--forest);font-weight:400;line-height:1.1;margin-bottom:1.2rem}
  .ty-msg{font-size:1rem;color:var(--stone);margin-bottom:2.4rem;line-height:1.75}
  .ty-cta{display:inline-block;padding:.85rem 2rem;background:var(--forest);color:var(--ivory);border-radius:4px;font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;font-weight:500;text-decoration:none;transition:background .3s}
  .ty-cta:hover{background:var(--sage)}
  .ty-foot{margin-top:3rem;font-size:.78rem;color:var(--mist);letter-spacing:.05em}
  .ty-foot a{color:var(--gold);text-decoration:none}
  .ty-foot a:hover{text-decoration:underline}
</style>
</head>
<body>
  <div class="ty-wrap">
    <div class="ty-mark">✓</div>
    <div class="ty-eyebrow">Order received</div>
    <h1 class="ty-title">Thank you.</h1>
    <p class="ty-msg">We received your order and a confirmation is on its way to your inbox. We will be in touch within 24 hours to finalize delivery details.</p>
    <a class="ty-cta" href="index.html">Return to home</a>
    <div class="ty-foot">Questions? Email <a href="mailto:byfernstudio@gmail.com">byfernstudio@gmail.com</a></div>
  </div>
</body>
</html>
```

- [ ] **Step 2: Open it in a browser to confirm it renders**

```bash
open /Users/eespinoz/fern-studio/thank-you.html
```

Expected: a centered confirmation card with the green check mark, the
"Thank you." headline, and a "Return to home" button.

- [ ] **Step 3: Commit**

```bash
git add thank-you.html
git commit -m "Add post-checkout thank-you page"
```

---

## Task 7: Booqable settings (Erika's manual to-do, documented here)

**Files:** none (Booqable admin UI)

These steps happen in `byfernstudio.booqable.com` admin, not in code.
Document them here so they don't get lost.

- [ ] **Step 1: Set the return URL**

Booqable admin → **Settings → Online Store → Redirect URL after purchase**
(naming varies). Set to:

```
https://coffeefab.github.io/fern-studio/thank-you.html
```

- [ ] **Step 2: Confirm deposit percentage is 25%**

Booqable admin → **Settings → Payments → Deposit**. Verify the deposit
is set to 25%. If different, decide whether to adjust here or update
`cartDepCents()` in `shop.html` to match. The displayed deposit on our
cart and the actual deposit Booqable charges must agree.

- [ ] **Step 3: Confirm Stripe is in test mode for now**

Booqable admin → **Settings → Payment Methods → Stripe**. Toggle to
"Test mode" while we verify end-to-end. We flip to live after Task 8 passes.

---

## Task 8: End-to-end test in Stripe test mode

**Files:** none (verification)

- [ ] **Step 1: Push everything to GitHub Pages**

```bash
git push origin main
```

Wait ~60 seconds for GitHub Pages to redeploy.

- [ ] **Step 2: Hard-refresh the live shop page**

Open `https://coffeefab.github.io/fern-studio/shop.html` and Cmd-Shift-R
to bypass cache.

- [ ] **Step 3: Run a full purchase with the Stripe test card**

- Add one product to the cart
- Pick a rental date in the shop's date bar (a few weeks out)
- Open the cart drawer
- Choose "Pickup" (skip delivery for the first run)
- Click "Checkout · pay deposit"
- Confirm the redirect lands on a Booqable checkout page with the right item and date
- Fill in customer name / email / address
- Pay with Stripe test card: `4242 4242 4242 4242`, any future expiry, any 3-digit CVC, any ZIP
- Confirm the redirect lands on `coffeefab.github.io/fern-studio/thank-you.html`
- Open `byfernstudio.booqable.com` admin and confirm the order appears with status indicating the 25% deposit was paid

- [ ] **Step 4: Repeat with delivery enabled**

Same flow, choose "Yes ($40)". Confirm the Booqable order includes the
delivery line item and the deposit reflects the additional $40.

- [ ] **Step 5: Test the error path**

In DevTools, temporarily block requests to `byfernstudio.booqable.com`
(or change `BOOQABLE_KEY` to a bad value). Click checkout. Confirm the
red error banner appears above the checkout button and the button
re-enables.

- [ ] **Step 6: Flip Booqable Stripe to live mode**

After Steps 3-5 all pass, switch Booqable's Stripe connection from test
mode to live mode. Run one more real $1 test if comfortable, then
refund it from the Stripe dashboard.

---

## Booqable API reference

> Filled in during Task 1. Until that task runs, treat the API shape used in Task 3
> as a placeholder skeleton.

- **Endpoint:** _TBD by Task 1_
- **Auth:** `api_key` query parameter, value `BOOQABLE_KEY`
- **Request body shape:** _TBD by Task 1_
- **Response field with customer URL:** _TBD by Task 1_
- **Delivery product ID:** _TBD by Task 4 Step 5 curl_
