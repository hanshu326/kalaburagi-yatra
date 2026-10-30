# Kalaburagi Yatra: circuit booking platform

Online booking for Kalaburagi's Heritage, Spiritual, Nature and Youth circuits, with online payment and **a separate QR ticket for every circuit**. Built from the *Kalaburagi Yatra UI Design* deck (District Administration, Tourism Department).

## Scope

| Phase | Panels | Status |
|---|---|---|
| **1 (this repo)** | **Customer** and **Travel owner** | Done |
| 2 | Admin (approvals, refunds) and Super admin (users, roles, gateway, audit log) | Planned |

### Customer panel
- Browse 8 circuits, filter by type, colour band per type, trip bar showing how many QR tickets will be issued
- Account sign-up and sign-in
- Checkout: traveller details, then payment by UPI, card or net banking
- Totals (2% convenience fee) are **calculated on the server**, never trusted from the browser
- One booking ID and one signed QR per circuit, arch-shaped tickets, My bookings, print
- Works on a 390px phone screen

### Travel owner panel
- Operator switcher (an owner can run several businesses)
- Overview: bookings, travellers, gross sales, payout after 10% commission, next departures
- Packages: edit price, switch a circuit on or off for customers
- Bookings: every booking for their circuits
- Check-in by typed booking ID or camera QR scan (where the browser supports `BarcodeDetector`); owners can only check in **their own** circuits

## Run it

Needs Node.js 22.5 or newer (uses the built-in `node:sqlite`, so there is no database to install).

```bash
npm install
npm start          # http://localhost:3000
npm test           # 10 API tests
```

The first start creates `data/yatra.db` and seeds demo data.

| Role | Email | Password |
|---|---|---|
| Customer | customer@demo.in | Demo@1234 |
| Travel owner | owner@demo.in | Demo@1234 |

Try the payment decline path with a card number ending `0002` (for example `4000 0000 0000 0002`). A valid test card is `4242 4242 4242 4242`.

## Project layout

```
src/
  server.js, app.js, config.js, db.js, seed.js
  lib/    auth (JWT), qr (signed tokens), payment (gateway interface), money, validate, http
  routes/ auth, circuits, orders (customer), owner
public/   index.html, css/styles.css, js/ (main router, store, api, views/)
test/     api.test.js
```

## Design decisions worth knowing

- **Signed QR codes.** The QR holds `KY1.<bookingId>.<HMAC>`. A forged or edited QR fails verification. Operators can also type the plain booking ID.
- **Payment gateway interface.** `src/lib/payment.js` exposes `createOrder` and `charge`. Phase 1 uses a demo provider that moves no money. Swapping in Razorpay, PayU or Cashfree means implementing those two methods plus server-side payment verification (the design deck lists this as a before-going-live item).
- **Idempotent payment.** Paying the same order twice returns the same tickets and never double-books.
- **Security basics.** bcrypt password hashes, JWT sessions, role checks on every route, ownership checks (customers see only their orders, owners only their circuits), parameterised SQL, input validation, no inline scripts (strict CSP), login rate limiting.
- **Money** is stored in whole rupees. Fee and commission round to the nearest rupee, which reproduces the deck's example: 2 travellers on Heritage 1, Spiritual 1 and Nature 1 = ₹12,594 + ₹252 fee = **₹12,846**.

## Known gaps (planned next)

- Real payment gateway and webhook verification
- Email or SMS ticket delivery, password reset
- Seat or capacity limits per departure date
- Kannada and Hindi, circuit photos and itinerary pages
- Admin and Super admin panels, audit log
- The Youth circuits are placeholders: the deck shows no Youth card, so names, stops and prices there are invented
- The demo rate limiter is in memory; use Redis if you run more than one server

## Production checklist

Set `NODE_ENV=production`, `JWT_SECRET` and `QR_SECRET` (the app refuses to start without them), serve over HTTPS, and back up `data/yatra.db`.
