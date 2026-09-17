const mongoose = require('mongoose');
const { User, WorldVersion } = require('./models');

let isConnected = false;

async function init() {
  if (isConnected) return;

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URL;

  if (mongoUri) {
    console.log('[DB] Connecting to MongoDB from environment variable...');
    await mongoose.connect(mongoUri);
    console.log('[DB] Connected to MongoDB database.');
  } else {
    // Attempt local mongodb first; if unavailable, start in-memory Mongo server
    try {
      console.log('[DB] Attempting local MongoDB connection at mongodb://localhost:27017/e4all ...');
      await mongoose.connect('mongodb://localhost:27017/e4all', { serverSelectionTimeoutMS: 2000 });
      console.log('[DB] Connected to local MongoDB instance.');
    } catch (err) {
      console.log('[DB] Local MongoDB not detected. Initializing embedded MongoMemoryServer for zero-config run...');
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const mongod = await MongoMemoryServer.create();
      const uri = mongod.getUri();
      await mongoose.connect(uri);
      console.log(`[DB] Embedded MongoDB running at ${uri}`);
    }
  }

  isConnected = true;

  // Seed default 4 players if empty
  const userCount = await User.countDocuments();
  if (userCount === 0) {
    console.log('[DB] Seeding default player accounts (password: password123)...');
    const defaultPlayers = [
      { username: 'player1', displayName: 'Player 1', password: 'password123', canHost: true, hasVoxy: true, color: '#10b981' },
      { username: 'player2', displayName: 'Player 2', password: 'password123', canHost: true, hasVoxy: true, color: '#3b82f6' },
      { username: 'player3', displayName: 'Player 3', password: 'password123', canHost: true, hasVoxy: true, color: '#a855f7' },
      { username: 'player4', displayName: 'Player 4', password: 'password123', canHost: false, hasVoxy: false, color: '#f59e0b' }
    ];

    for (const p of defaultPlayers) {
      const u = new User(p);
      await u.save();
    }
    console.log('[DB] Default player accounts created: player1, player2, player3, player4');
  }

  // Seed baseline world version v100 if empty
  const verCount = await WorldVersion.countDocuments();
  if (verCount === 0) {
    console.log('[DB] Initializing baseline world version v100...');
    const v100 = new WorldVersion({
      version: 100,
      parentVersion: null,
      createdByUsername: 'System',
      notes: 'Initial baseline authoritative world v100'
    });
    await v100.save();
  }

  console.log('[DB] MongoDB database initialized successfully.');
}

module.exports = {
  init,
  models: require('./models')
};
