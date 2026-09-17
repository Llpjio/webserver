const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/latest', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT w.*, p.name as player_name 
       FROM world_versions w
       LEFT JOIN players p ON w.created_by_player_id = p.id
       ORDER BY w.version DESC LIMIT 1`
    );
    res.json({ worldVersion: result.rows[0] || null });
  } catch (err) {
    next(err);
  }
});

router.get('/history', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT w.*, p.name as player_name, p.color as player_color, s.e4mc_address
       FROM world_versions w
       LEFT JOIN players p ON w.created_by_player_id = p.id
       LEFT JOIN sessions s ON w.session_id = s.id
       ORDER BY w.version DESC LIMIT 25`
    );
    res.json({ history: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
