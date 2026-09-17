const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res, next) => {
  try {
    const result = await db.query('SELECT id, name, can_host, has_voxy, mc_name, color FROM players ORDER BY id ASC');
    const players = result.rows.map(p => ({
      id: p.id,
      name: p.name,
      canHost: p.can_host === 1 || p.can_host === true,
      hasVoxy: p.has_voxy === 1 || p.has_voxy === true,
      mcName: p.mc_name,
      color: p.color
    }));
    res.json({ players });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
