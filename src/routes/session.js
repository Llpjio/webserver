const express = require('express');
const router = express.Router();
const sessionManager = require('../services/sessionManager');

// GET /api/session/status
router.get('/status', async (req, res, next) => {
  try {
    const status = await sessionManager.getStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
});

// POST /api/session/claim
router.post('/claim', async (req, res, next) => {
  try {
    const { playerId } = req.body;
    if (!playerId) {
      return res.status(400).json({ error: 'playerId is required' });
    }
    const result = await sessionManager.claimHost(parseInt(playerId, 10));
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, activeSession: err.activeSession });
    }
    next(err);
  }
});

// POST /api/session/ready
router.post('/ready', async (req, res, next) => {
  try {
    const { hostToken } = req.body;
    const status = await sessionManager.readySession(hostToken);
    res.json(status);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/session/online
router.post('/online', async (req, res, next) => {
  try {
    const { hostToken, e4mcAddress } = req.body;
    const status = await sessionManager.setSessionOnline(hostToken, e4mcAddress);
    res.json(status);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/session/e4mc
router.post('/e4mc', async (req, res, next) => {
  try {
    const { hostToken, e4mcAddress } = req.body;
    const status = await sessionManager.updateE4mc(hostToken, e4mcAddress);
    res.json(status);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/session/heartbeat
router.post('/heartbeat', async (req, res, next) => {
  try {
    const { hostToken } = req.body;
    const result = await sessionManager.recordHeartbeat(hostToken);
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/session/end
router.post('/end', async (req, res, next) => {
  try {
    const { hostToken } = req.body;
    const status = await sessionManager.beginEndSession(hostToken);
    res.json(status);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/session/finalize
router.post('/finalize', async (req, res, next) => {
  try {
    const { hostToken, notes } = req.body;
    const result = await sessionManager.finalizeSession(hostToken, notes);
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/session/release
router.post('/release', async (req, res, next) => {
  try {
    const { hostToken, force, playerId } = req.body;
    const status = await sessionManager.releaseSession(hostToken, !!force, playerId);
    res.json(status);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
