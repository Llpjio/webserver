const crypto = require('crypto');
const db = require('../db');
const { broadcast } = require('./websocket');

const HEARTBEAT_TIMEOUT_SECONDS = 90;

/**
 * Get full authoritative system status
 */
async function getStatus() {
  // 1. Get latest world version
  const latestVerRes = await db.query(
    'SELECT version, notes, created_at FROM world_versions ORDER BY version DESC LIMIT 1'
  );
  const latestVersion = latestVerRes.rows[0] || { version: 100, notes: 'Baseline' };

  // 2. Get active non-offline session
  const activeSessionRes = await db.query(
    `SELECT s.*, p.name as host_player_name, p.mc_name as host_mc_name, p.color as host_color
     FROM sessions s
     JOIN players p ON s.host_player_id = p.id
     WHERE s.status != 'OFFLINE'
     ORDER BY s.created_at DESC LIMIT 1`
  );

  let activeSession = activeSessionRes.rows[0] || null;
  let isStale = false;
  let secondsSinceHeartbeat = null;

  if (activeSession) {
    const lastHeartbeat = new Date(activeSession.last_heartbeat_at || activeSession.created_at).getTime();
    const now = Date.now();
    secondsSinceHeartbeat = Math.max(0, Math.floor((now - lastHeartbeat) / 1000));

    if (secondsSinceHeartbeat > HEARTBEAT_TIMEOUT_SECONDS) {
      isStale = true;
    }
  }

  return {
    status: activeSession ? activeSession.status : 'OFFLINE',
    isStale,
    secondsSinceHeartbeat,
    activeSession: activeSession ? {
      id: activeSession.id,
      hostPlayerId: activeSession.host_player_id,
      hostPlayerName: activeSession.host_player_name,
      hostMcName: activeSession.host_mc_name,
      hostColor: activeSession.host_color,
      status: activeSession.status,
      e4mcAddress: activeSession.e4mc_address,
      worldVersionStart: activeSession.world_version_start,
      worldVersionEnd: activeSession.world_version_end,
      sessionStartedAt: activeSession.session_started_at,
      lastHeartbeatAt: activeSession.last_heartbeat_at,
      createdAt: activeSession.created_at
    } : null,
    worldVersion: latestVersion.version,
    worldVersionDetails: latestVersion,
    serverTime: new Date().toISOString()
  };
}

/**
 * Atomic Host Claim
 */
async function claimHost(playerId) {
  // Check player capabilities
  const playerRes = await db.query('SELECT * FROM players WHERE id = $1', [playerId]);
  const player = playerRes.rows[0];

  if (!player) {
    throw { status: 404, message: 'Player not found' };
  }

  const canHost = player.can_host === 1 || player.can_host === true;
  if (!canHost) {
    throw { status: 403, message: `${player.name} is not configured as host-capable in E4ALL.` };
  }

  // Check if an active session already exists
  const existingRes = await db.query(
    `SELECT s.*, p.name as host_player_name 
     FROM sessions s 
     JOIN players p ON s.host_player_id = p.id 
     WHERE s.status != 'OFFLINE' 
     ORDER BY s.created_at DESC LIMIT 1`
  );

  if (existingRes.rows.length > 0) {
    const active = existingRes.rows[0];
    const lastHeartbeat = new Date(active.last_heartbeat_at || active.created_at).getTime();
    const ageSeconds = Math.floor((Date.now() - lastHeartbeat) / 1000);

    // If active session is genuinely abandoned (>120s without heartbeat and in CLAIMED/STARTING state),
    // we can allow clean auto-supersede. Otherwise reject atomically.
    if (ageSeconds > 120 && (active.status === 'CLAIMED' || active.status === 'STARTING')) {
      console.log(`[HostClaim] Stale abandoned session ${active.id} superseded by player ${player.name}`);
      await db.query(
        "UPDATE sessions SET status = 'OFFLINE', notes = 'Auto-expired due to stale host abandonment' WHERE id = $1",
        [active.id]
      );
    } else {
      throw {
        status: 409,
        message: `World is already claimed by ${active.host_player_name} (Status: ${active.status})`,
        activeSession: active
      };
    }
  }

  // Get current world version
  const latestVerRes = await db.query(
    'SELECT version FROM world_versions ORDER BY version DESC LIMIT 1'
  );
  const currentWorldVersion = latestVerRes.rows[0] ? latestVerRes.rows[0].version : 100;

  // Create new session
  const sessionId = crypto.randomUUID();
  const hostToken = crypto.randomBytes(24).toString('hex');
  const now = new Date().toISOString();

  await db.query(
    `INSERT INTO sessions 
     (id, host_player_id, host_token, status, e4mc_address, world_version_start, session_started_at, last_heartbeat_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [sessionId, playerId, hostToken, 'CLAIMED', null, currentWorldVersion, null, now, now]
  );

  const status = await getStatus();
  broadcast('SESSION_STATE_CHANGED', status);

  return {
    sessionId,
    hostToken,
    player: {
      id: player.id,
      name: player.name,
      canHost: true,
      hasVoxy: player.has_voxy === 1 || player.has_voxy === true
    },
    worldVersion: currentWorldVersion,
    status
  };
}

/**
 * Validate host token and return active session
 */
async function validateHostToken(hostToken) {
  if (!hostToken) {
    throw { status: 401, message: 'Host authentication token is required' };
  }

  const res = await db.query(
    "SELECT * FROM sessions WHERE host_token = $1 AND status != 'OFFLINE'",
    [hostToken]
  );

  if (res.rows.length === 0) {
    throw { status: 403, message: 'Invalid host token or session is no longer active' };
  }

  return res.rows[0];
}

/**
 * Advance host state to STARTING
 */
async function readySession(hostToken) {
  const session = await validateHostToken(hostToken);
  const now = new Date().toISOString();

  await db.query(
    "UPDATE sessions SET status = 'STARTING', last_heartbeat_at = $1 WHERE id = $2",
    [now, session.id]
  );

  const status = await getStatus();
  broadcast('SESSION_STATE_CHANGED', status);
  return status;
}

/**
 * Advance host state to ONLINE with e4mc link
 */
async function setSessionOnline(hostToken, e4mcAddress) {
  const session = await validateHostToken(hostToken);
  if (!e4mcAddress || typeof e4mcAddress !== 'string' || e4mcAddress.trim().length === 0) {
    throw { status: 400, message: 'Valid e4mc address is required (e.g. abcde.e4mc.link)' };
  }

  const cleanAddress = e4mcAddress.trim();
  const now = new Date().toISOString();

  await db.query(
    `UPDATE sessions 
     SET status = 'ONLINE', 
         e4mc_address = $1, 
         session_started_at = COALESCE(session_started_at, $2),
         last_heartbeat_at = $2 
     WHERE id = $3`,
    [cleanAddress, now, session.id]
  );

  const status = await getStatus();
  broadcast('SESSION_STATE_CHANGED', status);
  return status;
}

/**
 * Update e4mc address during active session
 */
async function updateE4mc(hostToken, e4mcAddress) {
  const session = await validateHostToken(hostToken);
  if (!e4mcAddress || typeof e4mcAddress !== 'string' || e4mcAddress.trim().length === 0) {
    throw { status: 400, message: 'Valid e4mc address is required' };
  }

  const cleanAddress = e4mcAddress.trim();
  const now = new Date().toISOString();

  await db.query(
    "UPDATE sessions SET e4mc_address = $1, last_heartbeat_at = $2 WHERE id = $3",
    [cleanAddress, now, session.id]
  );

  const status = await getStatus();
  broadcast('SESSION_STATE_CHANGED', status);
  return status;
}

/**
 * Receive heartbeat from host
 */
async function recordHeartbeat(hostToken) {
  const session = await validateHostToken(hostToken);
  const now = new Date().toISOString();

  await db.query(
    "UPDATE sessions SET last_heartbeat_at = $1 WHERE id = $2",
    [now, session.id]
  );

  return { success: true, timestamp: now };
}

/**
 * Host begins ending session -> status SAVING
 */
async function beginEndSession(hostToken) {
  const session = await validateHostToken(hostToken);
  const now = new Date().toISOString();

  await db.query(
    "UPDATE sessions SET status = 'SAVING', last_heartbeat_at = $1 WHERE id = $2",
    [now, session.id]
  );

  const status = await getStatus();
  broadcast('SESSION_STATE_CHANGED', status);
  return status;
}

/**
 * Host validates clean Minecraft stop, increments world version, transitions to OFFLINE
 */
async function finalizeSession(hostToken, notes = '') {
  const session = await validateHostToken(hostToken);
  const now = new Date().toISOString();

  // Get current version to calculate next version
  const latestVerRes = await db.query(
    'SELECT version FROM world_versions ORDER BY version DESC LIMIT 1'
  );
  const currentVer = latestVerRes.rows[0] ? latestVerRes.rows[0].version : 100;
  const nextVer = currentVer + 1;

  // Insert new authoritative world version
  const cleanNotes = notes && notes.trim().length > 0 
    ? notes.trim() 
    : `Session finished cleanly by host`;

  await db.query(
    `INSERT INTO world_versions (version, parent_version, created_by_player_id, session_id, notes, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [nextVer, currentVer, session.host_player_id, session.id, cleanNotes, now]
  );

  // Update session to OFFLINE
  await db.query(
    `UPDATE sessions 
     SET status = 'OFFLINE', 
         world_version_end = $1, 
         session_ended_at = $2, 
         notes = $3 
     WHERE id = $4`,
    [nextVer, now, cleanNotes, session.id]
  );

  const status = await getStatus();
  broadcast('SESSION_STATE_CHANGED', status);
  broadcast('WORLD_VERSION_UPDATED', { version: nextVer, notes: cleanNotes });

  return {
    success: true,
    newWorldVersion: nextVer,
    status
  };
}

/**
 * Release host lock without version bump (e.g. cancelled before start or force release)
 */
async function releaseSession(hostToken, force = false, playerId = null) {
  const now = new Date().toISOString();

  if (force) {
    // If forcing, verify active session exists
    const activeRes = await db.query("SELECT * FROM sessions WHERE status != 'OFFLINE' ORDER BY created_at DESC LIMIT 1");
    if (activeRes.rows.length === 0) {
      return await getStatus();
    }
    const session = activeRes.rows[0];
    await db.query(
      "UPDATE sessions SET status = 'OFFLINE', session_ended_at = $1, notes = 'Force released by player' WHERE id = $2",
      [now, session.id]
    );
  } else {
    const session = await validateHostToken(hostToken);
    await db.query(
      "UPDATE sessions SET status = 'OFFLINE', session_ended_at = $1, notes = 'Cancelled by host' WHERE id = $2",
      [now, session.id]
    );
  }

  const status = await getStatus();
  broadcast('SESSION_STATE_CHANGED', status);
  return status;
}

// Background reaper for heartbeat staleness
function startReaper() {
  setInterval(async () => {
    try {
      const activeRes = await db.query("SELECT * FROM sessions WHERE status != 'OFFLINE' LIMIT 1");
      if (activeRes.rows.length > 0) {
        const session = activeRes.rows[0];
        const lastHb = new Date(session.last_heartbeat_at || session.created_at).getTime();
        const ageSec = Math.floor((Date.now() - lastHb) / 1000);

        // If host was preparing (CLAIMED / STARTING) and disappeared for > 150 seconds, auto-release
        if (ageSec > 150 && (session.status === 'CLAIMED' || session.status === 'STARTING')) {
          console.log(`[Reaper] Releasing abandoned session ${session.id} (inactive for ${ageSec}s)`);
          await db.query(
            "UPDATE sessions SET status = 'OFFLINE', notes = 'Auto-released by coordinator due to inactivity' WHERE id = $1",
            [session.id]
          );
          const status = await getStatus();
          broadcast('SESSION_STATE_CHANGED', status);
        }
      }
    } catch (err) {
      console.error('[Reaper] Error in background reaper:', err.message);
    }
  }, 15000);
}

module.exports = {
  getStatus,
  claimHost,
  readySession,
  setSessionOnline,
  updateE4mc,
  recordHeartbeat,
  beginEndSession,
  finalizeSession,
  releaseSession,
  startReaper
};
