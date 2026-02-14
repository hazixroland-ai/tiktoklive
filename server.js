require("dotenv").config();

const path = require("path");
const express = require("express");
const http = require("http");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const bcrypt = require("bcryptjs");
const { nanoid } = require("nanoid");
const { Server } = require("socket.io");
const { WebcastPushConnection } = require("tiktok-live-connector");
const { pool } = require("./db");

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const ENABLE_TEST = (process.env.ENABLE_TEST || "true") === "true";

const app = express();
const server = http.createServer(app);

// Socket.io
const io = new Server(server, { cors: { origin: "*" } });

// Views + static
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Sessions (stored in Postgres so multiple instances work)
app.use(session({
  store: new pgSession({ pool, tableName: "session" }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  }
}));

// Basic helpers
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  next();
}

function normalizeSlug(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_\.\-]/g, "")
    .slice(0, 32);
}

function normalizeTikTokUsername(s) {
  return String(s || "").trim().replace(/^@+/, "").replace(/\s+/g, "");
}

async function getUserByEmail(email) {
  const r = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
  return r.rows[0] || null;
}

async function getUserById(id) {
  const r = await pool.query("SELECT * FROM users WHERE id=$1", [id]);
  return r.rows[0] || null;
}

async function getStreamerByUserId(userId) {
  const r = await pool.query("SELECT * FROM streamers WHERE user_id=$1", [userId]);
  return r.rows[0] || null;
}

async function getStreamerBySlug(slug) {
  const r = await pool.query("SELECT * FROM streamers WHERE slug=$1", [slug]);
  return r.rows[0] || null;
}

async function upsertStreamer(userId, { slug, tiktok_username }) {
  const overlay_key = nanoid(24);
  const now = new Date();

  const existing = await getStreamerByUserId(userId);
  if (!existing) {
    const r = await pool.query(
      `INSERT INTO streamers(user_id, slug, tiktok_username, overlay_key, is_active, created_at, updated_at)
       VALUES($1,$2,$3,$4,false, now(), now())
       RETURNING *`,
      [userId, slug, tiktok_username, overlay_key]
    );
    return r.rows[0];
  }

  const r = await pool.query(
    `UPDATE streamers
     SET slug=$2, tiktok_username=$3, updated_at=now()
     WHERE user_id=$1
     RETURNING *`,
    [userId, slug, tiktok_username]
  );
  return r.rows[0];
}

async function resetOverlayKey(streamerId) {
  const key = nanoid(24);
  const r = await pool.query(
    "UPDATE streamers SET overlay_key=$2, updated_at=now() WHERE id=$1 RETURNING *",
    [streamerId, key]
  );
  return r.rows[0];
}

// Health + home
app.get("/healthz", (_, res) => res.send("ok"));

app.get("/", async (req, res) => {
  const user = req.session.userId ? await getUserById(req.session.userId) : null;
  res.render("home", { user, baseUrl: BASE_URL });
});

// Auth
app.get("/signup", (req, res) => res.render("signup", { error: null }));
app.post("/signup", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!email || !password || password.length < 6) {
      return res.status(400).render("signup", { error: "กรอกอีเมลและรหัสผ่าน (อย่างน้อย 6 ตัวอักษร)" });
    }
    const exists = await getUserByEmail(email);
    if (exists) return res.status(400).render("signup", { error: "อีเมลนี้ถูกใช้แล้ว" });

    const password_hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      "INSERT INTO users(email, password_hash) VALUES($1,$2) RETURNING id",
      [email, password_hash]
    );
    req.session.userId = r.rows[0].id;
    res.redirect("/dashboard");
  } catch (e) {
    console.error(e);
    res.status(500).render("signup", { error: "สมัครไม่สำเร็จ ลองใหม่" });
  }
});

app.get("/login", (req, res) => res.render("login", { error: null }));
app.post("/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const user = await getUserByEmail(email);
    if (!user) return res.status(400).render("login", { error: "อีเมล/รหัสผ่านไม่ถูกต้อง" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(400).render("login", { error: "อีเมล/รหัสผ่านไม่ถูกต้อง" });

    req.session.userId = user.id;
    res.redirect("/dashboard");
  } catch (e) {
    console.error(e);
    res.status(500).render("login", { error: "ล็อกอินไม่สำเร็จ" });
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// Dashboard
app.get("/dashboard", requireAuth, async (req, res) => {
  const user = await getUserById(req.session.userId);
  const streamer = await getStreamerByUserId(user.id);
  const overlayUrl = streamer ? `${BASE_URL}/o/${streamer.slug}?k=${streamer.overlay_key}` : null;
  res.render("dashboard", { user, streamer, overlayUrl, error: null, ok: null, enableTest: ENABLE_TEST });
});

app.post("/dashboard/profile", requireAuth, async (req, res) => {
  const user = await getUserById(req.session.userId);
  const slug = normalizeSlug(req.body.slug);
  const tiktok_username = normalizeTikTokUsername(req.body.tiktok_username);

  if (!slug || !tiktok_username) {
    const streamer = await getStreamerByUserId(user.id);
    const overlayUrl = streamer ? `${BASE_URL}/o/${streamer.slug}?k=${streamer.overlay_key}` : null;
    return res.status(400).render("dashboard", {
      user, streamer, overlayUrl, error: "กรอก Slug และ TikTok Username", ok: null, enableTest: ENABLE_TEST
    });
  }

  try {
    const streamer = await upsertStreamer(user.id, { slug, tiktok_username });
    const overlayUrl = `${BASE_URL}/o/${streamer.slug}?k=${streamer.overlay_key}`;
    res.render("dashboard", { user, streamer, overlayUrl, error: null, ok: "บันทึกแล้ว", enableTest: ENABLE_TEST });
  } catch (e) {
    console.error(e);
    const streamer = await getStreamerByUserId(user.id);
    const overlayUrl = streamer ? `${BASE_URL}/o/${streamer.slug}?k=${streamer.overlay_key}` : null;
    res.status(400).render("dashboard", {
      user, streamer, overlayUrl, error: "Slug นี้อาจถูกใช้แล้ว ลองเปลี่ยนใหม่", ok: null, enableTest: ENABLE_TEST
    });
  }
});

app.post("/dashboard/reset-key", requireAuth, async (req, res) => {
  const user = await getUserById(req.session.userId);
  const streamer = await getStreamerByUserId(user.id);
  if (!streamer) return res.redirect("/dashboard");
  const updated = await resetOverlayKey(streamer.id);

  // Also kick existing overlay connections by changing key (they'll fail to auth next time)
  const overlayUrl = `${BASE_URL}/o/${updated.slug}?k=${updated.overlay_key}`;
  res.render("dashboard", { user, streamer: updated, overlayUrl, error: null, ok: "รีเซ็ตคีย์แล้ว", enableTest: ENABLE_TEST });
});

// Overlay page (public)
app.get("/o/:slug", async (req, res) => {
  const slug = normalizeSlug(req.params.slug);
  const streamer = await getStreamerBySlug(slug);
  if (!streamer) return res.status(404).send("Overlay not found");
  res.render("overlay", {
    slug: streamer.slug,
    // key stays in querystring; overlay reads it from location.search
    title: `Overlay - ${streamer.slug}`
  });
});

// Socket auth: client sends {slug, key} in auth. Join room "streamer:<id>"
io.use(async (socket, next) => {
  try {
    const slug = normalizeSlug(socket.handshake.auth?.slug);
    const key = String(socket.handshake.auth?.key || "");
    if (!slug || !key) return next(new Error("missing auth"));

    const streamer = await getStreamerBySlug(slug);
    if (!streamer) return next(new Error("not found"));
    if (key !== streamer.overlay_key) return next(new Error("bad key"));

    socket.data.streamer = streamer;
    next();
  } catch (e) {
    next(new Error("auth error"));
  }
});

io.on("connection", (socket) => {
  const streamer = socket.data.streamer;
  const room = `streamer:${streamer.id}`;
  socket.join(room);
  socket.emit("hello", { ok: true, slug: streamer.slug });

  socket.on("disconnect", () => {});
});

// TikTok connection manager (in-memory)
const connections = new Map(); // streamerId -> { conn, username }

async function connectStreamer(streamer) {
  const key = streamer.id;
  if (connections.has(key)) return { ok: true, already: true };

  const conn = new WebcastPushConnection(streamer.tiktok_username, {
    enableExtendedGiftInfo: true
  });

  const connect = async () => {
    try {
      await conn.connect();
      console.log("✅ TikTok connected:", streamer.tiktok_username, "for", streamer.slug);
    } catch (e) {
      console.error("⚠️ TikTok connect failed for", streamer.slug, "-", e?.message || e);
      setTimeout(connect, 5000);
    }
  };

  conn.on("gift", (data) => {
    const room = `streamer:${streamer.id}`;
    io.to(room).emit("newGift", {
      username: data.uniqueId,
      giftName: data.giftName,
      giftCount: data.repeatCount,
      giftId: data.giftId
    });
  });

  conn.on("disconnected", () => {
    console.log("🔌 TikTok disconnected:", streamer.slug, "- reconnecting...");
    setTimeout(connect, 3000);
  });

  connections.set(key, { conn, username: streamer.tiktok_username });

  await connect();
  return { ok: true, already: false };
}

function disconnectStreamer(streamerId) {
  const existing = connections.get(streamerId);
  if (!existing) return { ok: true, already: true };
  try {
    existing.conn.disconnect();
  } catch {}
  connections.delete(streamerId);
  return { ok: true, already: false };
}

// Start/Stop endpoints (auth required)
app.post("/api/start", requireAuth, async (req, res) => {
  const streamer = await getStreamerByUserId(req.session.userId);
  if (!streamer) return res.status(400).send("no streamer profile");

  await pool.query("UPDATE streamers SET is_active=true, updated_at=now() WHERE id=$1", [streamer.id]);
  await connectStreamer(streamer);

  res.json({ ok: true });
});

app.post("/api/stop", requireAuth, async (req, res) => {
  const streamer = await getStreamerByUserId(req.session.userId);
  if (!streamer) return res.status(400).send("no streamer profile");

  await pool.query("UPDATE streamers SET is_active=false, updated_at=now() WHERE id=$1", [streamer.id]);
  disconnectStreamer(streamer.id);

  res.json({ ok: true });
});

// Test gift for this streamer (auth)
app.post("/api/test-gift", requireAuth, async (req, res) => {
  if (!ENABLE_TEST) return res.status(404).send("disabled");
  const streamer = await getStreamerByUserId(req.session.userId);
  if (!streamer) return res.status(400).send("no streamer profile");

  const username = String(req.body.username || "tester").slice(0, 40);
  const giftName = String(req.body.giftName || "Rose").slice(0, 60);
  const giftCount = Math.max(1, Math.min(999, Number(req.body.giftCount || 1)));

  const room = `streamer:${streamer.id}`;
  io.to(room).emit("newGift", { username, giftName, giftCount, giftId: "TEST" });
  res.json({ ok: true });
});

server.listen(PORT, () => {
  console.log("🚀 Listening on", PORT);
  console.log("BASE_URL =", BASE_URL);
});
