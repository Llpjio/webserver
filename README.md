# E4ALL — Minecraft World Host Coordinator

A private coordination web service and dashboard for a four-player Minecraft Java Edition group.

E4ALL guarantees that only one player hosts the world at a time, coordinates the host lifecycle, exposes the ephemeral **e4mc** tunnel address to the group in real-time, manages atomic host locking with keepalive heartbeats, and tracks authoritative world versions (e.g. `v100` &rarr; `v101`).

---

## 👥 Player Roles & Capabilities

| Player | Capable Host? | Neo Voxy? | Role Description |
|---|:---:|:---:|---|
| **Player 1** | ✅ Yes | ✅ Yes | Host-capable; local Neo Voxy LOD rendering |
| **Player 2** | ✅ Yes | ✅ Yes | Host-capable; local Neo Voxy LOD rendering |
| **Player 3** | ✅ Yes | ✅ Yes | Host-capable; local Neo Voxy LOD rendering |
| **Player 4** | ❌ No | ❌ No | Client-only player; never hosts; connects directly |

> [!IMPORTANT]
> **Authoritative World vs Neo Voxy**: Neo Voxy caches are strictly client-side LOD render caches and are kept local to each PC. They are **never** synced as authoritative world data. Only the Minecraft save state is synchronized.

---

## 🚀 Key Features

1. **Atomic Host Claiming**:
   - `POST /api/session/claim` uses database-level concurrency control so if multiple players click "Become Host" simultaneously, exactly one claim succeeds (`200 OK`) and conflicting requests receive `409 Conflict`.
2. **e4mc Tunnel Sharing**:
   - Real-time display of the host's ephemeral `*.e4mc.link` address with 1-click clipboard copying for connecting players.
3. **Keepalive Heartbeats & Stale Detection**:
   - The active host transmits heartbeats every 15 seconds. If the host connection drops for >90s, the server marks the session as stale and provides a safe force-release mechanism.
4. **World Version Incrementing**:
   - Clean shutdown records session notes and safely increments the authoritative world version.
5. **Dual Database Support**:
   - **Local Development**: Runs with zero configuration using native SQLite.
   - **Render Production**: Automatically connects to managed PostgreSQL when `DATABASE_URL` is set.
6. **Real-time Live Sync**:
   - Integrated WebSocket server (`/ws`) broadcasts state changes instantly across all players' open browsers.

---

## 🛠️ Local Development

### Prerequisites
- Node.js v20+ (tested on Node.js v24)
- npm

### Setup & Run
```bash
# 1. Install dependencies
npm install

# 2. Run automated tests
npm test

# 3. Start local development server
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ☁️ Deploying to Render

### Method 1: Render Blueprint (Recommended)
This repository includes a `render.yaml` Blueprint that automatically provisions both the Node.js Web Service and the free-tier PostgreSQL database.

1. Push your repository to **GitHub**.
2. Go to the [Render Dashboard](https://dashboard.render.com).
3. Click **New +** &rarr; **Blueprint**.
4. Connect your GitHub repository.
5. Render will automatically detect `render.yaml` and configure:
   - **Web Service**: `e4all-coordinator`
   - **Database**: `e4all-db` (PostgreSQL)
6. Click **Apply**. Render will build and deploy the coordinator!

### Method 2: Manual Web Service Setup
1. In Render, click **New +** &rarr; **Web Service**.
2. Connect your repo:
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/healthz`
3. Under **Environment Variables**, add:
   - `NODE_ENV`: `production`
   - `PORT`: `10000`
   - `DATABASE_URL`: *(Connect your Render Postgres connection string)*

---

## 📡 API Reference

| Endpoint | Method | Description |
|---|:---:|---|
| `/healthz` | `GET` | Healthcheck endpoint for Render |
| `/api/players` | `GET` | List all 4 players and capabilities |
| `/api/session/status` | `GET` | Current session state, active host, timer, e4mc address |
| `/api/session/claim` | `POST` | Claim host lease (`{ playerId }`) |
| `/api/session/ready` | `POST` | Mark local world checked & ready (`{ hostToken }`) |
| `/api/session/online` | `POST` | Submit e4mc link & start session (`{ hostToken, e4mcAddress }`) |
| `/api/session/e4mc` | `POST` | Update e4mc link (`{ hostToken, e4mcAddress }`) |
| `/api/session/heartbeat` | `POST` | Host keepalive ping (`{ hostToken }`) |
| `/api/session/end` | `POST` | Begin session shutdown (`{ hostToken }`) |
| `/api/session/finalize` | `POST` | Publish new world version & return to OFFLINE (`{ hostToken, notes }`) |
| `/api/session/release` | `POST` | Cancel claim or force-reset stale session |
| `/api/world/latest` | `GET` | Current authoritative world version info |
| `/api/world/history` | `GET` | Version history and session log |
| `/ws` | `WS` | Real-time WebSocket event stream |
