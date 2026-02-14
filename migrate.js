/**
 * Run DB migrations (idempotent).
 * Local:   node migrate.js
 * Fly:     fly ssh console -a <app> -C "node migrate.js"
 */
require("dotenv").config();
const { pool } = require("./db");

const sql = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS streamers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug text UNIQUE NOT NULL,
  tiktok_username text NOT NULL,
  overlay_key text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_streamers_user_id ON streamers(user_id);
`;

(async () => {
  try {
    await pool.query(sql);
    console.log("✅ Migrations applied.");
  } catch (e) {
    console.error("❌ Migration failed:", e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
