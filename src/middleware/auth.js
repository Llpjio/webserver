const jwt = require('jsonwebtoken');
const { User } = require('../db/models');

const JWT_SECRET = process.env.JWT_SECRET || 'e4all-minecraft-secret-key-2026';

function generateToken(user) {
  return jwt.sign(
    { 
      id: user._id.toString(), 
      username: user.username,
      displayName: user.displayName,
      canHost: user.canHost,
      hasVoxy: user.hasVoxy,
      color: user.color
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'User account not found' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired session token. Please sign in again.' });
  }
}

// Optional auth (extracts user if present, but doesn't block)
async function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (user) req.user = user;
    } catch (e) {
      // ignore
    }
  }
  next();
}

module.exports = {
  generateToken,
  authenticateToken,
  optionalAuth,
  JWT_SECRET
};
