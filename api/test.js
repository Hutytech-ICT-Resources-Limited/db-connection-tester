// Vercel serverless function that tests a database connection string and reports back.
// The connection string is supplied per request and is NEVER stored, logged, or cached.
// Supports PostgreSQL, MySQL, and MongoDB.

const CONNECT_TIMEOUT_MS = 10000;
const MAX_OBJECTS = 50;

// Block connections to loopback / private / link-local hosts (basic SSRF protection).
function isBlockedHost(hostname) {
  if (!hostname) return true;
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "0.0.0.0") return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

function detectType(cs) {
  if (/^postgres(ql)?:\/\//i.test(cs)) return "postgres";
  if (/^mysql:\/\//i.test(cs)) return "mysql";
  if (/^mongodb(\+srv)?:\/\//i.test(cs)) return "mongo";
  if (/^(mssql|sqlserver):\/\//i.test(cs)) return "mssql";
  if (/^rediss?:\/\//i.test(cs)) return "redis";
  return null;
}

function hostFrom(cs) {
  try {
    return new URL(cs).hostname;
  } catch (e) {
    return null;
  }
}

async function testPostgres(cs) {
  const { Client } = require("pg");
  const variants = [{ ssl: { rejectUnauthorized: false } }, { ssl: false }];
  let lastErr;
  for (const v of variants) {
    const client = new Client({ connectionString: cs, connectionTimeoutMillis: CONNECT_TIMEOUT_MS, query_timeout: 8000, ...v });
    try {
      const t0 = Date.now();
      await client.connect();
      const latencyMs = Date.now() - t0;
      const ver = await client.query("SELECT version()");
      const tbls = await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_name LIMIT " + MAX_OBJECTS
      );
      await client.end();
      return {
        type: "PostgreSQL",
        latencyMs,
        version: String(ver.rows[0].version).split(" on ")[0],
        objectLabel: "tables",
        objects: tbls.rows.map((r) => r.table_name),
      };
    } catch (e) {
      lastErr = e;
      try { await client.end(); } catch (_) {}
      if (!/ssl|secure|sslmode/i.test(e.message || "")) break;
    }
  }
  throw lastErr;
}

async function testMysql(cs) {
  const mysql = require("mysql2/promise");
  const variants = [{ ssl: { rejectUnauthorized: false } }, {}];
  let lastErr;
  for (const v of variants) {
    let conn;
    try {
      const t0 = Date.now();
      conn = await mysql.createConnection({ uri: cs, connectTimeout: CONNECT_TIMEOUT_MS, ...v });
      const latencyMs = Date.now() - t0;
      const [verRows] = await conn.query("SELECT VERSION() AS v");
      const [tblRows] = await conn.query("SHOW TABLES");
      await conn.end();
      const objects = tblRows.map((row) => Object.values(row)[0]).slice(0, MAX_OBJECTS);
      return { type: "MySQL", latencyMs, version: "MySQL " + verRows[0].v, objectLabel: "tables", objects };
    } catch (e) {
      lastErr = e;
      try { if (conn) await conn.end(); } catch (_) {}
      if (!/ssl|secure/i.test(e.message || "")) break;
    }
  }
  throw lastErr;
}

async function testMongo(cs) {
  const { MongoClient } = require("mongodb");
  const client = new MongoClient(cs, { serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS, connectTimeoutMS: CONNECT_TIMEOUT_MS });
  try {
    const t0 = Date.now();
    await client.connect();
    await client.db().command({ ping: 1 });
    const latencyMs = Date.now() - t0;
    let version = "MongoDB";
    try {
      const info = await client.db().admin().serverInfo();
      version = "MongoDB " + info.version;
    } catch (_) {}
    let objects = [];
    try {
      const cols = await client.db().listCollections().toArray();
      objects = cols.map((c) => c.name).slice(0, MAX_OBJECTS);
    } catch (_) {}
    await client.close();
    return { type: "MongoDB", latencyMs, version, objectLabel: "collections", objects };
  } catch (e) {
    try { await client.close(); } catch (_) {}
    throw e;
  }
}

async function testMssql(cs) {
  const sql = require("mssql");
  const u = new URL(cs);
  const baseConfig = {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    server: u.hostname,
    port: u.port ? +u.port : 1433,
    database: u.pathname.replace(/^\//, "") || undefined,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    requestTimeout: 8000,
  };
  const variants = [
    { options: { encrypt: true, trustServerCertificate: true } },
    { options: { encrypt: false, trustServerCertificate: true } },
  ];
  let lastErr;
  for (const v of variants) {
    let pool;
    try {
      const t0 = Date.now();
      pool = await new sql.ConnectionPool({ ...baseConfig, ...v }).connect();
      const latencyMs = Date.now() - t0;
      const ver = await pool.request().query("SELECT @@VERSION AS v");
      const tbls = await pool.request().query(
        "SELECT TOP " + MAX_OBJECTS + " TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME"
      );
      await pool.close();
      return {
        type: "SQL Server",
        latencyMs,
        version: String(ver.recordset[0].v).split("\n")[0].trim(),
        objectLabel: "tables",
        objects: tbls.recordset.map((r) => r.TABLE_NAME),
      };
    } catch (e) {
      lastErr = e;
      try { if (pool) await pool.close(); } catch (_) {}
      if (!/encrypt|ssl|secure|certificate/i.test(e.message || "")) break;
    }
  }
  throw lastErr;
}

async function testRedis(cs) {
  const { createClient } = require("redis");
  const client = createClient({
    url: cs,
    socket: { connectTimeout: CONNECT_TIMEOUT_MS, reconnectStrategy: false },
  });
  client.on("error", function () {});
  try {
    const t0 = Date.now();
    await client.connect();
    await client.ping();
    const latencyMs = Date.now() - t0;
    let version = "Redis";
    try {
      const info = await client.info("server");
      const m = /redis_version:([^\r\n]+)/.exec(info);
      if (m) version = "Redis " + m[1].trim();
    } catch (_) {}
    let total = 0;
    try { total = await client.dbSize(); } catch (_) {}
    const keys = [];
    try {
      for await (const entry of client.scanIterator({ COUNT: MAX_OBJECTS })) {
        // node-redis may yield a single key (string) or a batch (array of keys)
        if (Array.isArray(entry)) keys.push(...entry);
        else keys.push(entry);
        if (keys.length >= MAX_OBJECTS) break;
      }
    } catch (_) {}
    keys.length = Math.min(keys.length, MAX_OBJECTS);
    await client.quit();
    return {
      type: "Redis",
      latencyMs,
      version: version + " · " + total + " keys total",
      objectLabel: "sample keys",
      objects: keys,
    };
  } catch (e) {
    try { await client.quit(); } catch (_) {}
    try { await client.disconnect(); } catch (_) {}
    throw e;
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: { message: "Method not allowed" } });
  }

  const { connectionString } = req.body || {};

  if (!connectionString || !connectionString.trim()) {
    return res.status(400).json({
      ok: false,
      error: { message: "Please enter a database connection string.", name: "missing_connection_string" },
    });
  }

  const cs = connectionString.trim();
  const type = detectType(cs);

  if (!type) {
    return res.status(400).json({
      ok: false,
      error: {
        message: "Unrecognized connection string. Must start with postgres://, mysql://, mongodb://, mssql://, or redis://.",
        name: "unsupported_scheme",
      },
    });
  }

  if (isBlockedHost(hostFrom(cs))) {
    return res.status(400).json({
      ok: false,
      error: { message: "Connections to localhost or private/internal addresses are not allowed.", name: "blocked_host" },
    });
  }

  try {
    let result;
    if (type === "postgres") result = await testPostgres(cs);
    else if (type === "mysql") result = await testMysql(cs);
    else if (type === "mongo") result = await testMongo(cs);
    else if (type === "mssql") result = await testMssql(cs);
    else result = await testRedis(cs);

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      error: { message: (err && err.message) || "Could not connect.", name: (err && err.code) || (err && err.name) || "connection_error" },
    });
  }
};
