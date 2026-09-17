const express = require('express');
const router = express.Router();
const { WorldVersion } = require('../db/models');

router.get('/latest', async (req, res, next) => {
  try {
    const latest = await WorldVersion.findOne().sort({ version: -1 });
    res.json({ worldVersion: latest || null });
  } catch (err) {
    next(err);
  }
});

router.get('/history', async (req, res, next) => {
  try {
    const history = await WorldVersion.find().sort({ version: -1 }).limit(30);
    res.json({
      history: history.map(w => ({
        version: w.version,
        player_name: w.createdByUsername,
        notes: w.notes,
        created_at: w.createdAt.toISOString()
      }))
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
