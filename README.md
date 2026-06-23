# Database Connection Tester

A simple, secure web tool to check whether a **database connection string** actually connects, and
to tell you exactly why it doesn't. Paste a string, click **Test connection**, and get an instant
result.

🔗 **Live:** https://db-connection-tester.vercel.app

> Nothing to install. Open the link, paste your connection string, and test.

Supports **PostgreSQL, MySQL, MongoDB, Microsoft SQL Server, and Redis**, which also covers MariaDB,
CockroachDB, Redshift, and the managed providers (Supabase, Neon, Railway, PlanetScale, MongoDB
Atlas, Azure SQL, Upstash, Render, and more).

---

## What it does

1. You paste **your own** connection string, e.g. `postgresql://user:pass@host:5432/dbname`.
2. You click **Test connection**.
3. A pop-up shows the result:
   - ✅ **Connected!** The database type, response time, server version, and a sample of its
     tables / collections / keys.
   - ❌ **Connection failed.** The exact reason (wrong password, host unreachable, SSL required,
     timeout, database not found, and so on).

## Why it's useful

"Can't connect to the database" is one of the most common and time-wasting problems in development.
This tells you in seconds whether the connection string, credentials, host, and network are good, so
you know if the problem is the string or your app.

## Error reference

| Result | Meaning |
|--------|---------|
| ✅ Connected | String is valid and the database is reachable. |
| ❌ Auth failed | Wrong username or password. |
| ❌ `ECONNREFUSED` | Wrong port, or the database isn't running. |
| ❌ Timeout / `ETIMEDOUT` | Wrong host, or a firewall/IP-allowlist is blocking you. |
| ❌ `ENOTFOUND` | The host name doesn't resolve (typo in the host). |
| ❌ Unsupported | Must start with `postgres://`, `mysql://`, `mongodb://`, `mssql://`, or `redis://`. |

## Privacy & safety

Your connection string is **never stored**. It is used once to test the connection, then discarded.
Connections to localhost and private/internal addresses are blocked, and there is a 10-second
timeout so nothing hangs.

---

Developed with love by **[Hutech ICT Resources](https://hutytechict.com/)**.
