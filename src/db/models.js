const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true },
  displayName: { type: String, required: true, trim: true },
  minecraftUsername: { type: String, default: '' },
  canHost: { type: Boolean, default: true },
  hasVoxy: { type: Boolean, default: true },
  color: { type: String, default: '#10b981' },
  createdAt: { type: Date, default: Date.now }
});

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Active Session Schema
const sessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  hostUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  hostUsername: { type: String, required: true },
  hostDisplayName: { type: String, required: true },
  hostColor: { type: String, default: '#10b981' },
  status: { 
    type: String, 
    enum: ['OFFLINE', 'CLAIMED', 'STARTING', 'ONLINE', 'SAVING'], 
    default: 'OFFLINE' 
  },
  e4mcAddress: { type: String, default: null },
  worldVersionStart: { type: Number, required: true, default: 100 },
  worldVersionEnd: { type: Number, default: null },
  sessionStartedAt: { type: Date, default: null },
  sessionEndedAt: { type: Date, default: null },
  lastHeartbeatAt: { type: Date, default: Date.now },
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

// World Version & Backup History Schema (Aternos style + Delta Sync)
const worldVersionSchema = new mongoose.Schema({
  version: { type: Number, required: true, unique: true },
  parentVersion: { type: Number, default: null },
  title: { type: String, default: '' },
  createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdByUsername: { type: String, default: 'System' },
  sessionId: { type: String, default: null },
  notes: { type: String, default: '' },
  fileUrl: { type: String, default: null },
  fileName: { type: String, default: null },
  fileSize: { type: Number, default: 0 },
  storageType: { type: String, enum: ['gdrive', 'r2', 'local', 'none'], default: 'none' },
  gdriveFileId: { type: String, default: null },
  gdriveFolderId: { type: String, default: null },
  // Delta Sync fields
  manifest: { type: Object, default: {} }, // { "region/r.0.0.mca": { sha256: "...", size: 1234 } }
  deltaFileUrl: { type: String, default: null },
  deltaFileName: { type: String, default: null },
  deltaFileSize: { type: Number, default: 0 },
  deltaChangedFilesCount: { type: Number, default: 0 },
  totalFiles: { type: Number, default: 0 },
  isLocked: { type: Boolean, default: false },
  isAuthoritative: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

// Google OAuth Account Schema (for automatic Aternos-style backups)
const googleAccountSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  name: { type: String, default: '' },
  picture: { type: String, default: '' },
  tokens: {
    access_token: { type: String },
    refresh_token: { type: String },
    scope: { type: String },
    token_type: { type: String },
    expiry_date: { type: Number }
  },
  folderId: { type: String, default: null },
  folderName: { type: String, default: 'E4ALL Backups' },
  storageQuota: {
    usage: { type: Number, default: 0 },
    limit: { type: Number, default: 0 }
  },
  connectedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  autoBackupsEnabled: { type: Boolean, default: true },
  lastSyncedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Session = mongoose.model('Session', sessionSchema);
const WorldVersion = mongoose.model('WorldVersion', worldVersionSchema);
const GoogleAccount = mongoose.model('GoogleAccount', googleAccountSchema);

module.exports = {
  User,
  Session,
  WorldVersion,
  GoogleAccount
};
