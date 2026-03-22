// ============================================================
//  KEY SERVER — deploy on Railway (railway.app)
//
//  SETUP (takes ~2 min):
//  1. Go to railway.app → New Project → Deploy from GitHub repo
//     OR: New Project → Empty Project → Add Service → GitHub Repo
//     Upload this file as server.js in a repo, also add package.json
//  2. Railway gives you a public URL like:
//     https://yourapp.up.railway.app
//  3. Set one environment variable in Railway:
//     API_SECRET = anything you want (e.g. ks_fire99)
//  4. Put that URL + secret in destination.html and KeySystem.lua
// ============================================================

const http  = require("http");
const PORT  = process.env.PORT || 3000;
const SECRET = process.env.API_SECRET || "changeme";

// In-memory store — keys live here until they expire
// (Railway restarts wipe this, but keys only last 1 min so that's fine)
const keys = new Map();

// Auto-clean expired keys every 30s
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of keys) {
    if (now > v.expires_at) keys.delete(k);
  }
}, 30000);

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type":                "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => raw += chunk);
    req.on("end", () => {
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error("bad json")); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  const url = req.url.split("?")[0];

  // ── GET /ping ───────────────────────────────────────────────
  if (url === "/ping" && req.method === "GET") {
    return send(res, 200, { ok: true, ts: Date.now(), keys: keys.size });
  }

  // ── POST /register ──────────────────────────────────────────
  // Called by destination.html when a key is generated
  // Body: { key, expires_at, secret }
  if (url === "/register" && req.method === "POST") {
    let body;
    try { body = await readBody(req); }
    catch { return send(res, 400, { error: "bad json" }); }

    if (body.secret !== SECRET) return send(res, 401, { error: "unauthorized" });

    const expiresAt = new Date(body.expires_at).getTime();
    if (isNaN(expiresAt)) return send(res, 400, { error: "invalid expires_at" });

    keys.set(body.key, {
      key:        body.key,
      expires_at: expiresAt,
      hwid:       null,
      created_at: Date.now(),
    });

    console.log(`[register] key=${body.key} expires=${body.expires_at}`);
    return send(res, 200, { ok: true });
  }

  // ── POST /validate ──────────────────────────────────────────
  // Called by the Lua script
  // Body: { key, hwid }
  if (url === "/validate" && req.method === "POST") {
    let body;
    try { body = await readBody(req); }
    catch { return send(res, 400, { error: "bad json" }); }

    const { key, hwid } = body;
    if (!key || !hwid) return send(res, 400, { valid: false, reason: "missing_fields" });

    const record = keys.get(key);

    if (!record) {
      console.log(`[validate] not_found key=${key}`);
      return send(res, 200, { valid: false, reason: "not_found" });
    }

    // Expired?
    if (Date.now() > record.expires_at) {
      keys.delete(key);
      console.log(`[validate] expired key=${key}`);
      return send(res, 200, { valid: false, reason: "expired" });
    }

    // First use — bind HWID
    if (!record.hwid) {
      record.hwid = hwid;
      console.log(`[validate] bound key=${key} hwid=${hwid}`);
      return send(res, 200, { valid: true, reason: "bound" });
    }

    // Wrong device
    if (record.hwid !== hwid) {
      console.log(`[validate] wrong_hwid key=${key}`);
      return send(res, 200, { valid: false, reason: "wrong_hwid" });
    }

    console.log(`[validate] ok key=${key}`);
    return send(res, 200, { valid: true, reason: "ok" });
  }

  return send(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`[KeyServer] Running on port ${PORT}`);
});
