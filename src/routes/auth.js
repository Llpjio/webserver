const express = require('express');
const router = express.Router();
const { User } = require('../db/models');
const { generateToken, authenticateToken } = require('../middleware/auth');

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { username, password, displayName, minecraftUsername, canHost, hasVoxy } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const cleanUsername = username.trim().toLowerCase();
    if (cleanUsername.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    const existing = await User.findOne({ username: cleanUsername });
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // Default colors palette
    const colors = ['#10b981', '#3b82f6', '#a855f7', '#f59e0b', '#ec4899', '#06b6d4'];
    const assignedColor = colors[Math.floor(Math.random() * colors.length)];

    const user = new User({
      username: cleanUsername,
      password,
      displayName: displayName && displayName.trim() ? displayName.trim() : cleanUsername,
      minecraftUsername: minecraftUsername ? minecraftUsername.trim() : cleanUsername,
      canHost: canHost !== undefined ? !!canHost : true,
      hasVoxy: hasVoxy !== undefined ? !!hasVoxy : true,
      color: assignedColor
    });

    await user.save();
    const token = generateToken(user);

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        displayName: user.displayName,
        minecraftUsername: user.minecraftUsername,
        canHost: user.canHost,
        hasVoxy: user.hasVoxy,
        color: user.color
      }
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const user = await User.findOne({ username: cleanUsername });

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = generateToken(user);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        displayName: user.displayName,
        minecraftUsername: user.minecraftUsername,
        canHost: user.canHost,
        hasVoxy: user.hasVoxy,
        color: user.color
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, (req, res) => {
  const user = req.user;
  res.json({
    user: {
      id: user._id,
      username: user.username,
      displayName: user.displayName,
      minecraftUsername: user.minecraftUsername,
      canHost: user.canHost,
      hasVoxy: user.hasVoxy,
      color: user.color
    }
  });
});

module.exports = router;
