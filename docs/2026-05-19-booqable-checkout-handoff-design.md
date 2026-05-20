# Booqable Checkout Handoff Design

Date: 2026-05-19
Author: Erika + Claude

## Goal

Let customers on the Fern Studio shop pay a 25% deposit online with a card,
without building or hosting a custom payment backend, and without splitting
order data across two systems.

## Approach

Booqable already holds the product catalog, prices, inventory, and a connected
Stripe account. We hand the cart off to Booqable's hosted checkout at the
"Checkout" moment instead of building parallel Stripe code.

## User flow

1. Customer browses `shop.html`, picks dates, adjusts quantities, opens the
   cart drawer, picks delivery yes or no, clicks "Checkout · pay deposit".
2. JavaScript on `shop.html` POSTs the cart contents (product IDs,
   quantities, rental date range, delivery flag) to Booqable's cart API
   using the existing public `BOOQABLE_KEY`.
3. Booqable returns a cart token and hosted checkout URL of the shape
   `https://byfernstudio.booqable.com/cart/...`.
4. The site clears the local cart in `localStorage` and redirects to that
   URL.
5. Booqable collects customer name, email, address, and card. Booqable
   charges 25% deposit via the connected Stripe account.
6. After payment, Booqable redirects back to
   `https://coffeefab.github.io/fern-studio/thank-you.html`.
7. Erika sees the order, the customer, and the Stripe charge inside the
   Booqable dashboard. No second system.

## Code changes

All in `shop.html`:

1. Replace the no-op `cartCheckoutBtn` handler with a real call to the
   Booqable cart API followed by a redirect.
2. Show inline error above the cart drawer's footer if the API call fails,
   re-enable the button so the customer can retry. Same pattern as the
   booking-form fix in commit `8a5ae65`.
3. Delete the unfinished Stripe Elements code:
   - The `<script src="https://js.stripe.com/v3/">` tag near the top
   - The `STRIPE_PK` placeholder around line 733
   - The `stripeObj` and `stripeCard` variables
   - Any references to a Stripe card element in the checkout step UI

New page:

4. `thank-you.html` with a centered confirmation message and a button back
   to the homepage. Copy: "Thank you. We received your order and a
   confirmation is on its way to your inbox. We will be in touch within
   24 hours to finalize delivery details." Brand voice "we", no first names.

## Booqable prerequisites (already in place per Erika)

- Stripe connected in Booqable Settings → Payment Methods.
- Deposit percentage set to 25%.
- Self-service checkout enabled.
- Return URL in Booqable settings set to the thank-you page above.

## Error handling

- Cart API call fails (network, auth, validation): show inline red banner
  inside the cart drawer with the API message, re-enable the checkout
  button, keep the local cart intact so the customer can retry.
- Cart is empty when button is clicked: button is already disabled in this
  state; no extra handling needed.
- Customer abandons checkout on Booqable: Booqable's standard cart-recovery
  behavior applies. The local cart on our site stays cleared, so if they
  come back we treat it as a fresh visit.

## Testing

1. Booqable Stripe in test mode.
2. Add a product, hit checkout, verify redirect to Booqable cart.
3. Pay with Stripe test card `4242 4242 4242 4242`, any future expiry,
   any CVC.
4. Confirm redirect lands on `thank-you.html`.
5. Confirm the order shows up in Booqable admin with status "paid deposit".
6. Confirm the cart on our site is cleared.
7. Flip Booqable to live mode when verified.

## Out of scope (deferred)

- SMS confirmations to customer (would need Twilio + serverless).
- Custom-designed checkout UI on Fern Studio side (would need a real
  backend and PCI considerations).
- Webhooks back into our site (Booqable already emails Erika on every
  paid order, so a webhook is not needed yet).
