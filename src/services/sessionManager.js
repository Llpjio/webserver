const crypto = require('crypto');
const { User, Session, WorldVersion } = require('../db/models');
const { broadcast } = require('./websocket');

const HEARTBEAT_TIMEOUT_SECONDS = 90;

/**
 * Get full authoritative system status
 */
async function getStatus() {
  const latestVer = await WorldVersion.findOne().sort({ version: -1 });
  const currentWorldVersion = latestVer ? latestVer.version : 100;

  const activeSession = await Session.findOne({ status: { $ne: 'OFFLINE' } }).sort({ createdAt: -1 });

  let isStale = false;
  let secondsSinceHeartbeat = null;

  if (activeSession) {
    const lastHeartbeat = new Date(activeSession.lastHeartbeatAt || activeSession.createdAt).getTime();
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
      id: activeSession.sessionId,
      hostUserId: activeSession.hostUserId.toString(),
      hostUsername: activeSession.hostUsername,
      hostDisplayName: activeSession.hostDisplayName,
      hostColor: activeSession.hostColor,
      status: activeSession.status,
      e4mcAddress: activeSession.e4mcAddress,
      worldVersionStart: activeSession.worldVersionStart,
      worldVersionEnd: activeSession.worldVersionEnd,
      sessionStartedAt: activeSession.sessionStartedAt ? activeSession.sessionStartedAt.toISOString() : null,
      lastHeartbeatAt: activeSession.lastHeartbeatAt ? activeSession.lastHeartbeatAt.toISOString() : null,
      createdAt: activeSession.createdAt.toISOString()
    } : null,
    worldVersion: currentWorldVersion,
    worldVersionDetails: latestVer,
    serverTime: new Date().toISOString()
  };
}

/**
 * Atomic Host Claim by an Authenticated User
 */
async function claimHost(user) {
  if (!user.canHost) {
    throw { status: 403, message: `${user.displayName || user.username} is not configured as host-capable in E4ALL.` };
  }

  // Check if an active session already exists
  const active = await Session.findOne({ status: { $ne: 'OFFLINE' } }).sort({ createdAt: -1 });

  if (active) {
    const lastHeartbeat = new Date(active.lastHeartbeatAt || active.createdAt).getTime();
    const ageSeconds = Math.floor((Date.now() - lastHeartbeat) / 1000);

    // If abandoned (>120s without heartbeat in CLAIMED/STARTING state), auto-expire
    if (ageSeconds > 120 && (active.status === 'CLAIMED' || active.status === 'STARTING')) {
      console.log(`[HostClaim] Stale abandoned session ${active.sessionId} superseded by user ${user.username}`);
      active.status = 'OFFLINE';
      active.notes = 'Auto-expired due to stale host abandonment';
      active.sessionEndedAt = new Date();
      await active.save();
    } else {
      throw {
        status: 409,
        message: `World is currently claimed by ${active.hostDisplayName} (@${active.hostUsername}) (Status: ${active.status})`,
        activeSession: active
      };
    }
  }

  // Get current world version
  const latestVer = await WorldVersion.findOne().sort({ version: -1 });
  const currentWorldVersion = latestVer ? latestVer.version : 100;

  const sessionId = crypto.randomUUID();
  const now = new Date();

  const session = new Session({
    sessionId,
    hostUserId: user._id,
    hostUsername: user.username,
    hostDisplayName: user.displayName || user.username,
    hostColor: user.color || '#10b981',
    status: 'CLAIMED',
    e4mcAddress: null,
    worldVersionStart: currentWorldVersion,
    sessionStartedAt: null,
    lastHeartbeatAt: now,
    createdAt: now
  });

  await session.save();

  const status = await getStatus();
  broadcast('SESSION_STATE_CHANGED', status);

  return {
    sessionId,
    hostUser: {
      id: user._id,
      username: user.username,
      displayName: user.displayName,
      canHost: user.canHost,
      hasVoxy: user.hasVoxy
    },
    worldVersion: currentWorldVersion,
    status
  };
}

/**
 * Validate that the caller is the active host user
 */
async function validateActiveHost(user) {
  if (!user) {
    throw { status: 401, message: 'Authentication required' };
  }

  const session = await Session.findOne({ status: { $ne: 'OFFLINE' } }).sort({ createdAt: -1 });
  if (!session) {
    throw { status: 404, message: 'No active session found' };
  }

  if (session.hostUserId.toString() !== user._id.toString()) {
    throw { status: 403, message: `Only the active host (${session.hostDisplayName}) can perform this action.` };
  }

  return session;
}

/**
 * Host marks world verified & ready -> STARTING
 */
async function readySession(user) {
  const session = await validateActiveHost(user);
  session.status = 'STARTING';
  session.lastHeartbeatAt = new Date();
  await session.save();

  const status = await getStatus();
  broadcast('SESSION_STATE_CHANGED', status);
  return status;
}

/**
 * Host submits e4mc tunnel link -> ONLINE
 */
async function setSessionOnline(user, e4mcAddress) {
  const session = await validateActiveHost(user);
  if (!e4mcAddress || typeof e4mcAddress !== 'string' || e4mcAddress.trim().length === 0) {
    throw { status: 400, message: 'Valid e4mc address is required (e.g. abcde.e4mc.link)' };
  }

  const cleanAddress = e4mcAddress.trim();
  const now = new Date();

  session.status = 'ONLINE';
  session.e4mcAddress = cleanAddress;
  if (!session.sessionStartedAt) session.sessionStartedAt = now;
  session.lastHeartbeatAt = now;
  await session.save();

  const status = await getStatus();
  broadcast('SESSION_STATE_CHANGED', status);
  return status;
}

/**
 * Update e4mc address
 */
async function updateE4mc(user, e4mcAddress) {
  const session = await validateActiveHost(user);
  if (!e4mcAddress || typeof e4mcAddress !== 'string' || e4mcAddress.trim().length === 0) {
    throw { status: 400, message: 'Valid e4mc address is required' };
  }

  session.e4mcAddress = e4mcAddress.trim();
  session.lastHeartbeatAt = new Date();
  await session.save();

  const status = await getStatus();
  broadcast('SESSION_STATE_CHANGED', status);
  return status;
}

/**
 * Record keepalive heartbeat from host
 */
async function recordHeartbeat(user) {
  const session = await validateActiveHost(user);
  const now = new Date();
  session.lastHeartbeatAt = now;
  await session.save();
  return { success: true, timestamp: now.toISOString() };
}

/**
 * Host begins ending session -> SAVING
 */
async function beginEndSession(user) {
  const session = await validateActiveHost(user);
  session.status = 'SAVING';
  session.lastHeartbeatAt = new Date();
  await session.save();

  const status = await getStatus();
  broadcast('SESSION_STATE_CHANGED', status);
  return status;
}

/**
 * Host confirms Minecraft closed, increments world version -> OFFLINE
 */
async function finalizeSession(user, notes = '', fileInfo = null) {
  const session = await validateActiveHost(user);
  const now = new Date();

  const latestVer = await WorldVersion.findOne().sort({ version: -1 });
  const currentVer = latestVer ? latestVer.version : 100;
  const nextVer = currentVer + 1;

  const cleanNotes = notes && notes.trim().length > 0
    ? notes.trim()
    : `Session finished cleanly by ${user.displayName || user.username}`;

  const newVerDoc = new WorldVersion({
    version: nextVer,
    parentVersion: currentVer,
    createdByUserId: user._id,
    createdByUsername: user.displayName || user.username,
    sessionId: session.sessionId,
    notes: cleanNotes,
    fileUrl: fileInfo ? fileInfo.fileUrl : null,
    fileName: fileInfo ? fileInfo.fileName : null,
    fileSize: fileInfo ? fileInfo.fileSize : 0,
    storageType: fileInfo ? fileInfo.storageType : 'none',
    createdAt: now
  });
  await newVerDoc.save();

  session.status = 'OFFLINE';
  session.worldVersionEnd = nextVer;
  session.sessionEndedAt = now;
  session.notes = cleanNotes;
  await session.save();

  const status = await getStatus();
  broadcast('SESSION_STATE_CHANGED', status);
  broadcast('WORLD_VERSION_UPDATED', { version: nextVer, notes: cleanNotes, fileInfo });

  return {
    success: true,
    newWorldVersion: nextVer,
    fileInfo,
    status
  };
}

/**
 * Cancel or force release
 */
async function releaseSession(user, force = false) {
  const now = new Date();
  const session = await Session.findOne({ status: { $ne: 'OFFLINE' } }).sort({ createdAt: -1 });

  if (!session) {
    return await getStatus();
  }

  if (force) {
    session.status = 'OFFLINE';
    session.sessionEndedAt = now;
    session.notes = `Force released by ${user ? (user.displayName || user.username) : 'user'}`;
    await session.save();
  } else {
    if (session.hostUserId.toString() !== user._id.toString()) {
      throw { status: 403, message: 'Only the active host can cancel this session lease.' };
    }
    session.status = 'OFFLINE';
    session.sessionEndedAt = now;
    session.notes = 'Cancelled by host';
    await session.save();
  }

  const status = await getStatus();
  broadcast('SESSION_STATE_CHANGED', status);
  return status;
}

// Background reaper for abandoned host leases
function startReaper() {
  setInterval(async () => {
    try {
      const active = await Session.findOne({ status: { $in: ['CLAIMED', 'STARTING'] } }).sort({ createdAt: -1 });
      if (active) {
        const lastHb = new Date(active.lastHeartbeatAt || active.createdAt).getTime();
        const ageSec = Math.floor((Date.now() - lastHb) / 1000);

        if (ageSec > 150) {
          console.log(`[Reaper] Releasing abandoned session ${active.sessionId} (inactive for ${ageSec}s)`);
          active.status = 'OFFLINE';
          active.notes = 'Auto-released by coordinator due to inactivity';
          active.sessionEndedAt = new Date();
          await active.save();

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
