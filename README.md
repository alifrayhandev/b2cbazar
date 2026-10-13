# B2C Bazar — full-stack e-commerce starter

A minimal white + blue, multi-category store for Bangladesh with:
- Product catalogue served from a database
- Search, category filtering, cart, and BDT prices
- Cash-on-delivery checkout
- Bangladesh mobile number validation
- Server-side price and stock checks
- Admin login, product create/edit/hide, stock management
- Order list and order-status updates
- SQLite persistence and basic rate limiting/security headers

## Important: demo vs production

This is a working full-stack starter, not just a static frontend. Unlike a frontend-only demo, checkout POSTs to the server and orders are stored in SQLite; the admin panel reads those same saved orders. The server calculates prices from the database and decrements stock inside a database transaction.

Before accepting real customers:
1. Set a strong, unique `ADMIN_PASSWORD` and random `SESSION_SECRET`.
2. Deploy the Node server on a host that supports Node and persistent storage. A plain static Netlify site cannot run this Express server by itself. You can use Render/Railway/Fly.io for the server, or use Netlify only for the frontend after changing API URLs and deploying the backend separately.
3. Persist the SQLite database and session database on a persistent disk. On Render, mount a disk and set `DATABASE_PATH=/var/data/b2c-bazar.sqlite`; make sure the directory is writable.
4. Use HTTPS and verify the production cookie behavior.
5. Replace sample products, product photos, support email, delivery fee rules, and policies with your actual business information.
6. Add backups, monitoring, order notification (email/SMS), privacy/return/shipping pages, and a real courier workflow.
7. Test cancellations and stock adjustments before going live.
8. Do not use this as a payment gateway. The configured payment method is Cash on Delivery only.

SQLite is appropriate for a small starter store. For a larger store or multi-instance deployment, migrate to managed PostgreSQL and a production session store.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env
```

Edit `.env` before starting. Set a strong `ADMIN_PASSWORD` and a unique `SESSION_SECRET` (32+ characters). Then run:

```bash
npm start
```

Open:
- Store: http://localhost:3000
- Admin: http://localhost:3000/admin.html

The database and sessions are created automatically. Demo products are inserted only when the product catalogue is empty. Admin is created on first startup only when the configured username does not already exist and a non-placeholder password is set.

If you change `ADMIN_PASSWORD` after the admin account has already been created, the existing database password hash is not automatically changed. Reset the database only for a fresh test store, or implement an authenticated password-change/reset workflow before production.

## Deployment layout

Deploy this whole folder to a Node-capable service. Do not deploy only `public/` if you want orders and admin APIs to work. If you keep a Netlify domain for the frontend, configure a backend API URL and CORS/session cookie setup appropriately; same-origin cookies are simplest when frontend and API are served from the same domain.

## Business rules in this starter

- All prices are integer Bangladeshi taka (৳).
- Delivery fee is ৳80 for order subtotal under ৳3,000; free delivery at/above ৳3,000. Edit `server.js` to change it.
- COD is the only payment method.
- Orders start at `Pending`.
- Order statuses: Pending, Confirmed, Processing, Shipped, Delivered, Cancelled.
- Cancelling restores stock; reopening a cancelled order checks/decrements stock.
- Admin can hide products rather than hard-delete them, preserving order history.
