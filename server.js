\
const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const cors = require("cors");
const session = require("express-session");
const SQLite3 = require("sqlite3").verbose();
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const { nanoid } = require("nanoid");
const { WebcastPushConnection } = require("tiktok-live-connector");
const WebSocket = require("ws");

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SESSION_SECRET = process.env.SESSION_SECRET || "change_me";

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    store: new SQLiteStore({ db: "sessions.sqlite", dir: "./data" }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" },
  })
);

// ---------- DB ----------
const dataDir = path.join(__dirname, "data");
const fs = require("fs");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new SQLite3.Database(path.join(dataDir, "app.sqlite"));
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    pass_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS streamers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    tiktok_unique_id TEXT NOT NULL,
    overlay_token TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 100,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
});

// ---------- In-memory runtime state ----------
/**
 * runtime[streamerId] = {
 *  connected: boolean,
 *  bottle: {current, capacity, lastGift, updatedAt},
 *  conn: WebcastPushConnection|null,
 *  wsClients: Set<WebSocket>
 * }
 */
const runtime = new Map();

// ---------- Helpers ----------
function requireAuth(req, res, next) {
  if (!req.session?.user) return res.redirect("/login");
  next();
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function getRuntime(streamerId, capacity) {
  if (!runtime.has(streamerId)) {
    runtime.set(streamerId, {
      connected: false,
      bottle: { current: 0, capacity: capacity ?? 100, lastGift: null, updatedAt: Date.now() },
      conn: null,
      wsClients: new Set(),
    });
  }
  const r = runtime.get(streamerId);
  if (capacity != null) r.bottle.capacity = capacity;
  return r;
}

function broadcast(streamerId, msg) {
  const r = runtime.get(streamerId);
  if (!r) return;
  const data = JSON.stringify(msg);
  for (const ws of r.wsClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

// ---------- Rules ----------
function giftToPoints(data) {
  const diamondCount = Number(data.diamondCount || data.gift?.diamondCount || 0);
  const repeatCount = Number(data.repeatCount || 1);
  // 1) ถ้า diamondCount หาไม่ได้ ให้ขั้นต่ำ 1
  const per = Math.max(1, diamondCount || 1);
  return per * Math.max(1, repeatCount);
}

// ---------- Pages ----------
app.get("/", (req, res) => {
  if (req.session?.user) return res.redirect("/dashboard");
  res.redirect("/login");
});

app.get("/register", (req, res) => res.render("register", { error: null }));
app.post("/register", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!email || password.length < 6) {
    return res.render("register", { error: "กรอกอีเมล และรหัสผ่านอย่างน้อย 6 ตัวอักษร" });
  }
  const exist = await dbGet("SELECT id FROM users WHERE email = ?", [email]);
  if (exist) return res.render("register", { error: "อีเมลนี้ถูกใช้แล้ว" });

  const id = nanoid(12);
  const pass_hash = await bcrypt.hash(password, 10);
  await dbRun("INSERT INTO users (id,email,pass_hash,created_at) VALUES (?,?,?,?)", [
    id,
    email,
    pass_hash,
    Date.now(),
  ]);
  req.session.user = { id, email };
  res.redirect("/dashboard");
});

app.get("/login", (req, res) => res.render("login", { error: null }));
app.post("/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const u = await dbGet("SELECT * FROM users WHERE email = ?", [email]);
  if (!u) return res.render("login", { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
  const ok = await bcrypt.compare(password, u.pass_hash);
  if (!ok) return res.render("login", { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
  req.session.user = { id: u.id, email: u.email };
  res.redirect("/dashboard");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/dashboard", requireAuth, async (req, res) => {
  const streamers = await dbAll("SELECT * FROM streamers WHERE user_id = ? ORDER BY created_at DESC", [
    req.session.user.id,
  ]);
  // add runtime status
  const enriched = streamers.map((s) => {
    const r = runtime.get(s.id);
    return {
      ...s,
      connected: r ? r.connected : false,
      current: r ? r.bottle.current : 0,
    };
  });
  res.render("dashboard", { user: req.session.user, streamers: enriched, baseUrl: BASE_URL });
});

app.get("/streamers/new", requireAuth, (req, res) => {
  res.render("new_streamer", { error: null });
});

app.post("/streamers/new", requireAuth, async (req, res) => {
  const display_name = String(req.body.display_name || "").trim();
  const tiktok_unique_id = String(req.body.tiktok_unique_id || "").trim().replace(/^@/, "");
  const capacity = Math.max(10, Number(req.body.capacity || 100));
  if (!display_name || !tiktok_unique_id) {
    return res.render("new_streamer", { error: "กรอกชื่อที่แสดง และ TikTok username" });
  }
  const id = nanoid(10);
  const overlay_token = nanoid(24);
  await dbRun(
    "INSERT INTO streamers (id,user_id,display_name,tiktok_unique_id,overlay_token,capacity,created_at) VALUES (?,?,?,?,?,?,?)",
    [id, req.session.user.id, display_name, tiktok_unique_id, overlay_token, capacity, Date.now()]
  );
  // init runtime
  getRuntime(id, capacity);
  res.redirect("/dashboard");
});

app.post("/streamers/:id/listen/start", requireAuth, async (req, res) => {
  const streamerId = req.params.id;
  const s = await dbGet("SELECT * FROM streamers WHERE id = ? AND user_id = ?", [
    streamerId,
    req.session.user.id,
  ]);
  if (!s) return res.status(404).send("Not found");

  const r = getRuntime(streamerId, s.capacity);

  // disconnect old
  if (r.conn) {
    try { await r.conn.disconnect(); } catch {}
    r.conn = null;
    r.connected = false;
  }

  const conn = new WebcastPushConnection(s.tiktok_unique_id);
  r.conn = conn;

  conn.on("connected", () => {
    r.connected = true;
    broadcast(streamerId, { type: "status", connected: true, uniqueId: s.tiktok_unique_id });
  });

  conn.on("disconnected", () => {
    r.connected = false;
    broadcast(streamerId, { type: "status", connected: false, uniqueId: s.tiktok_unique_id });
  });

  conn.on("gift", (data) => {
    const giftName = data.giftName || data.gift?.name || "Gift";
    const senderName = data.uniqueId || data.nickname || data.user?.uniqueId || "viewer";
    const add = giftToPoints(data);

    r.bottle.current = Math.min(r.bottle.capacity, r.bottle.current + add);
    r.bottle.lastGift = { giftName, senderName, add };
    r.bottle.updatedAt = Date.now();

    broadcast(streamerId, { type: "gift_into_bottle", gift: r.bottle.lastGift, bottle: r.bottle });

    if (r.bottle.current >= r.bottle.capacity) {
      broadcast(streamerId, { type: "bottle_full", bottle: r.bottle });
    }
  });

  try {
    await conn.connect();
  } catch (e) {
    r.connected = false;
    broadcast(streamerId, { type: "status", connected: false, error: String(e?.message || e) });
  }

  res.redirect("/dashboard");
});

app.post("/streamers/:id/listen/stop", requireAuth, async (req, res) => {
  const streamerId = req.params.id;
  const s = await dbGet("SELECT * FROM streamers WHERE id = ? AND user_id = ?", [
    streamerId,
    req.session.user.id,
  ]);
  if (!s) return res.status(404).send("Not found");

  const r = runtime.get(streamerId);
  if (r?.conn) {
    try { await r.conn.disconnect(); } catch {}
    r.conn = null;
  }
  if (r) {
    r.connected = false;
    broadcast(streamerId, { type: "status", connected: false, uniqueId: s.tiktok_unique_id });
  }
  res.redirect("/dashboard");
});

// ---------- Overlay (public, token-protected) ----------
app.get("/overlay/:streamerId", async (req, res) => {
  const streamerId = req.params.streamerId;
  const token = String(req.query.token || "");
  const s = await dbGet("SELECT * FROM streamers WHERE id = ?", [streamerId]);
  if (!s || token !== s.overlay_token) return res.status(401).send("Unauthorized overlay");

  res.sendFile(path.join(__dirname, "public", "overlay.html"));
});

app.get("/api/overlay/:streamerId/state", async (req, res) => {
  const streamerId = req.params.streamerId;
  const token = String(req.query.token || "");
  const s = await dbGet("SELECT * FROM streamers WHERE id = ?", [streamerId]);
  if (!s || token !== s.overlay_token) return res.status(401).json({ error: "Unauthorized" });

  const r = getRuntime(streamerId, s.capacity);
  res.json({
    streamerId,
    displayName: s.display_name,
    uniqueId: s.tiktok_unique_id,
    connected: r.connected,
    bottle: r.bottle,
  });
});

app.post("/api/overlay/:streamerId/bottle/use", async (req, res) => {
  const streamerId = req.params.streamerId;
  const token = String(req.query.token || "");
  const s = await dbGet("SELECT * FROM streamers WHERE id = ?", [streamerId]);
  if (!s || token !== s.overlay_token) return res.status(401).json({ error: "Unauthorized" });

  const r = getRuntime(streamerId, s.capacity);
  const usedAmount = r.bottle.current;

  broadcast(streamerId, { type: "bottle_used", usedAmount, at: Date.now() });

  r.bottle.current = 0;
  r.bottle.lastGift = null;
  r.bottle.updatedAt = Date.now();

  broadcast(streamerId, { type: "bottle_reset", bottle: r.bottle });

  res.json({ ok: true, usedAmount, bottle: r.bottle });
});

// ---------- Start HTTP + WS ----------
const server = app.listen(PORT, () => {
  console.log(`Server: ${BASE_URL}`);
  console.log(`Open: ${BASE_URL}/register`);
});

const wss = new WebSocket.Server({ server, path: "/ws" });
wss.on("connection", async (ws, req) => {
  const url = new URL(req.url, BASE_URL);
  const streamerId = url.searchParams.get("streamerId");
  const token = url.searchParams.get("token");

  try {
    const s = await dbGet("SELECT * FROM streamers WHERE id = ?", [streamerId]);
    if (!s || token !== s.overlay_token) {
      ws.close(1008, "Unauthorized");
      return;
    }

    const r = getRuntime(streamerId, s.capacity);
    r.wsClients.add(ws);

    ws.send(
      JSON.stringify({
        type: "hello",
        displayName: s.display_name,
        uniqueId: s.tiktok_unique_id,
        connected: r.connected,
        bottle: r.bottle,
      })
    );

    ws.on("close", () => r.wsClients.delete(ws));
  } catch (e) {
    ws.close(1011, "Server error");
  }
});
