require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
const dbPath = path.resolve(process.env.DATABASE_PATH || "./data/b2c-bazar.sqlite");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.warn("WARNING: Set SESSION_SECRET to a unique random value of at least 32 characters.");
}
if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.includes("ChangeThis")) {
  console.warn("WARNING: Set a strong ADMIN_PASSWORD in .env before exposing this app publicly.");
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK(price >= 0),
  compare_price INTEGER NOT NULL DEFAULT 0 CHECK(compare_price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  district TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT 'Cash on Delivery',
  status TEXT NOT NULL DEFAULT 'Pending',
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  line_total INTEGER NOT NULL
);
`);

const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "";
const adminExists = db.prepare("SELECT id FROM admins WHERE username = ?").get(adminUsername);
if (!adminExists && adminPassword && !adminPassword.includes("ChangeThis")) {
  db.prepare("INSERT INTO admins(username, password_hash) VALUES (?, ?)").run(
    adminUsername, bcrypt.hashSync(adminPassword, 12)
  );
  console.log(`Created admin user "${adminUsername}".`);
}

// Demo products are inserted only into an empty catalogue. Replace them from Admin.
const productCount = db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
if (productCount === 0) {
  const demo = [
    ["Wireless Bluetooth Headphones", "Electronics", "Everyday wireless listening.", "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80", 1450, 1890, 20, 1],
    ["Minimal Everyday Wristwatch", "Accessories", "A clean everyday accessory.", "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80", 1850, 2300, 14, 1],
    ["Classic Casual Sneakers", "Fashion", "Casual comfort for daily wear.", "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80", 2250, 2700, 10, 1],
    ["Insulated Water Bottle", "Home & Living", "Reusable bottle for everyday use.", "https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=800&q=80", 650, 790, 30, 0],
    ["Soft Glow Table Lamp", "Home & Living", "Warm lighting for your space.", "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=800&q=80", 1290, 0, 8, 0],
    ["Daily Care Beauty Set", "Beauty", "A simple personal care set.", "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?auto=format&fit=crop&w=800&q=80", 990, 1190, 12, 0],
    ["Everyday Cotton T-Shirt", "Fashion", "A versatile wardrobe basic.", "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=800&q=80", 550, 0, 25, 0],
    ["Portable Bluetooth Speaker", "Electronics", "Compact sound for your day.", "https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&w=800&q=80", 1150, 1450, 16, 0]
  ];
  const insert = db.prepare(`INSERT INTO products(name,category,description,image,price,compare_price,stock,featured)
    VALUES(?,?,?,?,?,?,?,?)`);
  const tx = db.transaction(rows => rows.forEach(row => insert.run(...row)));
  tx(demo);
}

const SQLiteStore = SQLiteStoreFactory(session);
app.disable("x-powered-by");
if (isProduction) app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "https:", "data:"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  }
}));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "30kb" }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: path.dirname(dbPath) }),
  name: "b2cbazar.sid",
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret-before-deploy",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: isProduction, maxAge: 1000 * 60 * 60 * 8 }
}));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false });
const orderLimiter = rateLimit({ windowMs: 15 * 60 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false });
const moneyInt = v => Number.isInteger(v) && v >= 0 && v <= 100000000;
const text = (v, max = 500) => typeof v === "string" ? v.trim().slice(0, max) : "";
const publicProduct = p => ({
  id: p.id, name: p.name, category: p.category, description: p.description,
  image: p.image, price: p.price, comparePrice: p.compare_price,
  stock: p.stock, featured: Boolean(p.featured)
});
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.adminId) return res.status(401).json({ error: "Please sign in as admin." });
  next();
}
function requireCsrf(req, res, next) {
  const token = req.get("x-csrf-token");
  if (!req.session.csrfToken || !token || token !== req.session.csrfToken) {
    return res.status(403).json({ error: "Security token expired. Refresh the admin page and try again." });
  }
  next();
}
function makeOrderCode() {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
  return `B2C-${date}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
}

app.get("/api/health", (req, res) => res.json({ ok: true, service: "B2C Bazar API" }));
app.get("/api/products", (req, res) => {
  const rows = db.prepare("SELECT * FROM products WHERE active = 1 ORDER BY featured DESC, id DESC").all();
  res.json({ products: rows.map(publicProduct) });
});
app.get("/api/categories", (req, res) => {
  res.json({ categories: db.prepare("SELECT DISTINCT category FROM products WHERE active = 1 ORDER BY category").all().map(r => r.category) });
});

app.post("/api/orders", orderLimiter, (req, res) => {
  const body = req.body || {};
  const customerName = text(body.name, 100);
  const phone = text(body.phone, 25).replace(/[()\s-]/g, "");
  const address = text(body.address, 500);
  const district = text(body.district, 100);
  const email = text(body.email, 150);
  const note = text(body.note, 1000);
  const items = Array.isArray(body.items) ? body.items : [];
  if (customerName.length < 2 || !/^(?:\+?8801|01)[3-9]\d{8}$/.test(phone) || address.length < 5 || district.length < 2) {
    return res.status(400).json({ error: "Enter your name, a valid Bangladesh mobile number, full address, and district." });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (!items.length || items.length > 30) return res.status(400).json({ error: "Your cart is empty or has too many different items." });

  const normalized = new Map();
  for (const item of items) {
    const id = Number(item.id), qty = Number(item.quantity);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 20) return res.status(400).json({ error: "Invalid product quantity." });
    normalized.set(id, (normalized.get(id) || 0) + qty);
  }
  const getProduct = db.prepare("SELECT * FROM products WHERE id = ? AND active = 1");
  const tx = db.transaction(() => {
    const lines = [];
    let subtotal = 0;
    for (const [id, qty] of normalized.entries()) {
      const p = getProduct.get(id);
      if (!p) throw new Error("One of your products is no longer available. Refresh the shop and try again.");
      if (p.stock < qty) throw new Error(`${p.name} has only ${p.stock} item(s) in stock.`);
      lines.push({ product: p, qty, lineTotal: p.price * qty });
      subtotal += p.price * qty;
    }
    const deliveryFee = subtotal >= 3000 ? 0 : 80;
    const orderCode = makeOrderCode();
    const result = db.prepare(`INSERT INTO orders(order_code,customer_name,phone,email,address,district,note,payment_method,status,subtotal,delivery_fee,total)
      VALUES(?,?,?,?,?,?,?,'Cash on Delivery','Pending',?,?,?)`)
      .run(orderCode, customerName, phone, email, address, district, note, subtotal, deliveryFee, subtotal + deliveryFee);
    const orderId = result.lastInsertRowid;
    const addLine = db.prepare(`INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity,line_total) VALUES(?,?,?,?,?,?)`);
    const decrement = db.prepare("UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND stock >= ?");
    for (const line of lines) {
      addLine.run(orderId, line.product.id, line.product.name, line.product.price, line.qty, line.lineTotal);
      const update = decrement.run(line.qty, line.product.id, line.qty);
      if (update.changes !== 1) throw new Error("Stock changed while placing the order. Please try again.");
    }
    return { orderCode, subtotal, deliveryFee, total: subtotal + deliveryFee };
  });
  try {
    const order = tx();
    return res.status(201).json({ message: "Order received.", order });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Could not create order." });
  }
});

// Admin authentication
app.post("/api/admin/login", loginLimiter, async (req, res) => {
  const username = text(req.body?.username, 100);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const admin = db.prepare("SELECT * FROM admins WHERE username = ?").get(username);
  const ok = admin && await bcrypt.compare(password, admin.password_hash);
  if (!ok) return res.status(401).json({ error: "Incorrect username or password." });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Could not start admin session." });
    req.session.adminId = admin.id;
    req.session.username = admin.username;
    req.session.csrfToken = require("crypto").randomBytes(32).toString("hex");
    req.session.save(saveErr => {
      if (saveErr) return res.status(500).json({ error: "Could not save admin session." });
      res.json({ username: admin.username, csrfToken: req.session.csrfToken });
    });
  });
});
app.get("/api/admin/session", (req, res) => {
  if (!req.session?.adminId) return res.status(401).json({ error: "Not signed in." });
  res.json({ username: req.session.username, csrfToken: req.session.csrfToken });
});
app.post("/api/admin/logout", requireAdmin, requireCsrf, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("b2cbazar.sid");
    res.json({ ok: true });
  });
});
app.get("/api/admin/dashboard", requireAdmin, (req, res) => {
  const totals = {
    products: db.prepare("SELECT COUNT(*) n FROM products").get().n,
    activeProducts: db.prepare("SELECT COUNT(*) n FROM products WHERE active=1").get().n,
    orders: db.prepare("SELECT COUNT(*) n FROM orders").get().n,
    pendingOrders: db.prepare("SELECT COUNT(*) n FROM orders WHERE status='Pending'").get().n,
    revenue: db.prepare("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status IN ('Confirmed','Processing','Shipped','Delivered')").get().n
  };
  res.json({ totals });
});
app.get("/api/admin/products", requireAdmin, (req, res) => {
  res.json({ products: db.prepare("SELECT * FROM products ORDER BY id DESC").all() });
});
app.post("/api/admin/products", requireAdmin, requireCsrf, (req, res) => {
  const p = req.body || {};
  const name = text(p.name, 160), category = text(p.category, 80), description = text(p.description, 1500), image = text(p.image, 1000);
  const price = Number(p.price), comparePrice = Number(p.comparePrice || 0), stock = Number(p.stock);
  if (name.length < 2 || category.length < 2 || !moneyInt(price) || !moneyInt(comparePrice) || !Number.isInteger(stock) || stock < 0 || stock > 1000000) {
    return res.status(400).json({ error: "Check product name, category, price, compare price and stock." });
  }
  if (image && !/^https:\/\/|^\//i.test(image)) return res.status(400).json({ error: "Product image must use HTTPS or a local path." });
  const result = db.prepare(`INSERT INTO products(name,category,description,image,price,compare_price,stock,featured,active)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(name, category, description, image, price, comparePrice, stock, p.featured ? 1 : 0, p.active === false ? 0 : 1);
  res.status(201).json({ product: db.prepare("SELECT * FROM products WHERE id=?").get(result.lastInsertRowid) });
});
app.put("/api/admin/products/:id", requireAdmin, requireCsrf, (req, res) => {
  const id = Number(req.params.id), p = req.body || {};
  const name = text(p.name, 160), category = text(p.category, 80), description = text(p.description, 1500), image = text(p.image, 1000);
  const price = Number(p.price), comparePrice = Number(p.comparePrice || 0), stock = Number(p.stock);
  if (!Number.isInteger(id) || name.length < 2 || category.length < 2 || !moneyInt(price) || !moneyInt(comparePrice) || !Number.isInteger(stock) || stock < 0 || stock > 1000000) {
    return res.status(400).json({ error: "Check product name, category, price, compare price and stock." });
  }
  if (image && !/^https:\/\/|^\//i.test(image)) return res.status(400).json({ error: "Product image must use HTTPS or a local path." });
  const result = db.prepare(`UPDATE products SET name=?,category=?,description=?,image=?,price=?,compare_price=?,stock=?,featured=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(name, category, description, image, price, comparePrice, stock, p.featured ? 1 : 0, p.active === false ? 0 : 1, id);
  if (!result.changes) return res.status(404).json({ error: "Product not found." });
  res.json({ product: db.prepare("SELECT * FROM products WHERE id=?").get(id) });
});
app.delete("/api/admin/products/:id", requireAdmin, requireCsrf, (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare("UPDATE products SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  if (!result.changes) return res.status(404).json({ error: "Product not found." });
  res.json({ ok: true });
});
app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const orders = db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 500").all();
  const lines = db.prepare("SELECT * FROM order_items WHERE order_id=?");
  res.json({ orders: orders.map(o => ({ ...o, items: lines.all(o.id) })) });
});
app.patch("/api/admin/orders/:id/status", requireAdmin, requireCsrf, (req, res) => {
  const allowed = ["Pending", "Confirmed", "Processing", "Shipped", "Delivered", "Cancelled"];
  const status = text(req.body?.status, 30), id = Number(req.params.id);
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid order status." });
  const existing = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
  if (!existing) return res.status(404).json({ error: "Order not found." });
  const tx = db.transaction(() => {
    if (status === "Cancelled" && existing.status !== "Cancelled") {
      const items = db.prepare("SELECT product_id, quantity FROM order_items WHERE order_id=?").all(id);
      const restore = db.prepare("UPDATE products SET stock=stock+?, updated_at=CURRENT_TIMESTAMP WHERE id=?");
      items.forEach(i => { if (i.product_id) restore.run(i.quantity, i.product_id); });
    }
    if (existing.status === "Cancelled" && status !== "Cancelled") {
      const items = db.prepare("SELECT product_id, quantity FROM order_items WHERE order_id=?").all(id);
      for (const i of items) {
        if (!i.product_id) continue;
        const p = db.prepare("SELECT stock FROM products WHERE id=?").get(i.product_id);
        if (!p || p.stock < i.quantity) throw new Error("Not enough stock to reopen this cancelled order.");
      }
      const dec = db.prepare("UPDATE products SET stock=stock-?, updated_at=CURRENT_TIMESTAMP WHERE id=?");
      items.forEach(i => { if (i.product_id) dec.run(i.quantity, i.product_id); });
    }
    db.prepare("UPDATE orders SET status=? WHERE id=?").run(status, id);
  });
  try { tx(); res.json({ ok: true }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Unexpected server error." });
});

app.listen(PORT, () => console.log(`B2C Bazar running on http://localhost:${PORT}`));
