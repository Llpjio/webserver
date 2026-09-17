const express = require('express');
const router = express.Router();
const sessionManager = require('../services/sessionManager');
const { authenticateToken } = require('../middleware/auth');

// GET /api/session/status (Public)
router.get('/status', async (req, res, next) => {
  try {
    const status = await sessionManager.getStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
});

// POST /api/session/claim (Requires Auth)
router.post('/claim', authenticateToken, async (req, res, next) => {
  try {
    const result = await sessionManager.claimHost(req.user);
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, activeSession: err.activeSession });
    }
    next(err);
  }
});

// POST /api/session/ready (Requires Auth)
router.post('/ready', authenticateToken, async (req, res, next) => {
  try {
    const status = await sessionManager.readySession(req.user);
    res.json(status);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/session/online (Requires Auth)
router.post('/online', authenticateToken, async (req, res, next) => {
  try {
    const { e4mcAddress } = req.body;
    const status = await sessionManager.setSessionOnline(req.user, e4mcAddress);
    res.json(status);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/session/e4mc (Requires Auth)
router.post('/e4mc', authenticateToken, async (req, res, next) => {
  try {
    const { e4mcAddress } = req.body;
    const status = await sessionManager.updateE4mc(req.user, e4mcAddress);
    res.json(status);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/session/heartbeat (Requires Auth)
router.post('/heartbeat', authenticateToken, async (req, res, next) => {
  try {
    const result = await sessionManager.recordHeartbeat(req.user);
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/session/end (Requires Auth)
router.post('/end', authenticateToken, async (req, res, next) => {
  try {
    const status = await sessionManager.beginEndSession(req.user);
    res.json(status);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/session/finalize (Requires Auth)
router.post('/finalize', authenticateToken, async (req, res, next) => {
  try {
    const { notes } = req.body;
    const result = await sessionManager.finalizeSession(req.user, notes);
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/session/release (Requires Auth)
router.post('/release', authenticateToken, async (req, res, next) => {
  try {
    const { force } = req.body;
    const status = await sessionManager.releaseSession(req.user, !!force);
    res.json(status);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// GET /api/session/history (Public - MongoDB session history)
router.get('/history', async (req, res, next) => {
  try {
    const { Session } = require('../db/models');
    const sessions = await Session.find().sort({ createdAt: -1 }).limit(30);
    res.json({
      sessions: sessions.map(s => ({
        id: s.sessionId,
        hostUsername: s.hostUsername,
        hostDisplayName: s.hostDisplayName,
        hostColor: s.hostColor,
        status: s.status,
        e4mcAddress: s.e4mcAddress,
        worldVersionStart: s.worldVersionStart,
        worldVersionEnd: s.worldVersionEnd,
        sessionStartedAt: s.sessionStartedAt,
        sessionEndedAt: s.sessionEndedAt,
        notes: s.notes,
        createdAt: s.createdAt
      }))
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
