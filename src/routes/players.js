const express = require('express');
const router = express.Router();
const { User } = require('../db/models');

router.get('/', async (req, res, next) => {
  try {
    const users = await User.find().sort({ createdAt: 1 });
    const players = users.map(u => ({
      id: u._id.toString(),
      username: u.username,
      name: u.displayName || u.username,
      minecraftUsername: u.minecraftUsername,
      canHost: u.canHost,
      hasVoxy: u.hasVoxy,
      color: u.color
    }));
    res.json({ players });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
