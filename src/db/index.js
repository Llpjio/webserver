const path = require('path');
const fs = require('fs');

let dbClient = null;
let isPostgres = false;

const DATABASE_URL = process.env.DATABASE_URL;

if (DATABASE_URL) {
  const { Pool } = require('pg');
  isPostgres = true;
  dbClient = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  console.log('[DB] Using PostgreSQL connection from DATABASE_URL');
} else {
  const { DatabaseSync } = require('node:sqlite');
  isPostgres = false;
  const dbDir = path.join(__dirname, '../../data');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const dbPath = path.join(dbDir, 'e4all.db');
  dbClient = new DatabaseSync(dbPath);
  console.log(`[DB] Using local SQLite database at ${dbPath}`);
}

/**
 * Execute parameterized query
 * Supports $1, $2 Postgres syntax across both Postgres and SQLite.
 */
async function query(sqlText, params = []) {
  if (isPostgres) {
    const res = await dbClient.query(sqlText, params);
    return res;
  } else {
    // Map $1, $2, $3... to positional SQLite ? placeholders
    const sqliteParams = [];
    const sqliteSql = sqlText.replace(/\$(\d+)/g, (_, numStr) => {
      const idx = parseInt(numStr, 10) - 1;
      sqliteParams.push(params[idx]);
      return '?';
    });

    const isSelect = /^\s*(SELECT|PRAGMA)/i.test(sqliteSql);
    
    const stmt = dbClient.prepare(sqliteSql);
    if (isSelect) {
      const rows = stmt.all(...sqliteParams);
      return { rows, rowCount: rows.length };
    } else {
      const result = stmt.run(...sqliteParams);
      return { 
        rows: [], 
        rowCount: result.changes,
        lastInsertRowid: result.lastInsertRowid 
      };
    }
  }
}

async function init() {
  console.log('[DB] Initializing database schema...');

  // Create tables
  if (isPostgres) {
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        can_host BOOLEAN NOT NULL DEFAULT TRUE,
        has_voxy BOOLEAN NOT NULL DEFAULT TRUE,
        mc_name VARCHAR(50),
        color VARCHAR(20) DEFAULT '#10b981'
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(64) PRIMARY KEY,
        host_player_id INTEGER REFERENCES players(id),
        host_token VARCHAR(64) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'OFFLINE',
        e4mc_address VARCHAR(255),
        world_version_start INTEGER NOT NULL,
        world_version_end INTEGER,
        session_started_at TIMESTAMPTZ,
        session_ended_at TIMESTAMPTZ,
        last_heartbeat_at TIMESTAMPTZ,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS world_versions (
        version INTEGER PRIMARY KEY,
        parent_version INTEGER,
        created_by_player_id INTEGER REFERENCES players(id),
        session_id VARCHAR(64),
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } else {
    dbClient.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        can_host INTEGER NOT NULL DEFAULT 1,
        has_voxy INTEGER NOT NULL DEFAULT 1,
        mc_name TEXT,
        color TEXT DEFAULT '#10b981'
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        host_player_id INTEGER NOT NULL,
        host_token TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OFFLINE',
        e4mc_address TEXT,
        world_version_start INTEGER NOT NULL,
        world_version_end INTEGER,
        session_started_at TEXT,
        session_ended_at TEXT,
        last_heartbeat_at TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS world_versions (
        version INTEGER PRIMARY KEY,
        parent_version INTEGER,
        created_by_player_id INTEGER,
        session_id TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  // Seed default 4 players if empty
  const playersRes = await query('SELECT COUNT(*) as count FROM players');
  const count = parseInt(playersRes.rows[0].count || playersRes.rows[0].COUNT || 0, 10);
  if (count === 0) {
    console.log('[DB] Seeding default 4 players from project context...');
    const seedPlayers = [
      { id: 1, name: 'Player 1', can_host: 1, has_voxy: 1, mc_name: 'Player1', color: '#10b981' },
      { id: 2, name: 'Player 2', can_host: 1, has_voxy: 1, mc_name: 'Player2', color: '#3b82f6' },
      { id: 3, name: 'Player 3', can_host: 1, has_voxy: 1, mc_name: 'Player3', color: '#a855f7' },
      { id: 4, name: 'Player 4', can_host: 0, has_voxy: 0, mc_name: 'Player4', color: '#f59e0b' }
    ];

    for (const p of seedPlayers) {
      if (isPostgres) {
        await query(
          'INSERT INTO players (id, name, can_host, has_voxy, mc_name, color) VALUES ($1, $2, $3, $4, $5, $6)',
          [p.id, p.name, p.can_host === 1, p.has_voxy === 1, p.mc_name, p.color]
        );
      } else {
        await query(
          'INSERT INTO players (id, name, can_host, has_voxy, mc_name, color) VALUES ($1, $2, $3, $4, $5, $6)',
          [p.id, p.name, p.can_host, p.has_voxy, p.mc_name, p.color]
        );
      }
    }
  }

  // Seed baseline world version v100 if empty
  const versionsRes = await query('SELECT COUNT(*) as count FROM world_versions');
  const verCount = parseInt(versionsRes.rows[0].count || versionsRes.rows[0].COUNT || 0, 10);
  if (verCount === 0) {
    console.log('[DB] Initializing baseline world version v100...');
    const nowStr = new Date().toISOString();
    await query(
      'INSERT INTO world_versions (version, parent_version, created_by_player_id, session_id, notes, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [100, null, 1, null, 'Initial baseline authoritative world v100', nowStr]
    );
  }

  console.log('[DB] Database initialized successfully.');
}

module.exports = {
  query,
  init,
  isPostgres: () => isPostgres
};
