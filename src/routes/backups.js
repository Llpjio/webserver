const express = require('express');
const router = express.Router();
const multer = require('multer');
const { WorldVersion, Session } = require('../db/models');
const storageService = require('../services/storage');
const { authenticateToken } = require('../middleware/auth');
const { broadcast } = require('../services/websocket');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 } // 2GB max
});

// GET /api/backups - List all backups
router.get('/', async (req, res, next) => {
  try {
    const backups = await WorldVersion.find().sort({ version: -1 });
    const latest = backups.length > 0 ? backups[0] : null;
    const currentActiveVersion = latest ? latest.version : 100;

    const formatted = await Promise.all(backups.map(async b => {
      const downloadUrl = await storageService.getDownloadUrl(b.version, b);
      return {
        id: b._id,
        version: b.version,
        title: b.title || `World Backup v${b.version}`,
        parentVersion: b.parentVersion,
        createdBy: b.createdByUsername || 'System',
        notes: b.notes || '',
        fileName: b.fileName || `world_v${b.version}.zip`,
        fileSize: b.fileSize || 0,
        storageType: b.storageType || 'none',
        isLocked: !!b.isLocked,
        isActive: b.version === currentActiveVersion,
        downloadUrl,
        createdAt: b.createdAt.toISOString()
      };
    }));

    res.json({
      activeVersion: currentActiveVersion,
      totalBackups: formatted.length,
      backups: formatted
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/backups/create - Create a manual backup (Aternos style)
router.post('/create', authenticateToken, upload.single('worldFile'), async (req, res, next) => {
  try {
    const { title, notes, gdriveUrl } = req.body;

    const latest = await WorldVersion.findOne().sort({ version: -1 });
    const nextVer = latest ? latest.version + 1 : 100;

    let fileInfo = {
      fileName: `world_v${nextVer}.zip`,
      fileSize: 0,
      fileUrl: storageService.GDRIVE_STORAGE_URL,
      storageType: 'gdrive'
    };

    if (gdriveUrl && gdriveUrl.trim()) {
      fileInfo = storageService.processGoogleDriveLink(nextVer, gdriveUrl.trim());
    } else if (req.file) {
      fileInfo = await storageService.uploadWorldFile(
        nextVer,
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
    }

    const backupDoc = new WorldVersion({
      version: nextVer,
      parentVersion: latest ? latest.version : null,
      title: title && title.trim() ? title.trim() : `Manual Backup (v${nextVer})`,
      createdByUserId: req.user._id,
      createdByUsername: req.user.displayName || req.user.username,
      notes: notes && notes.trim() ? notes.trim() : 'Manual backup created',
      fileName: fileInfo.fileName,
      fileSize: fileInfo.fileSize,
      fileUrl: fileInfo.fileUrl,
      storageType: fileInfo.storageType,
      isLocked: false,
      isAuthoritative: true
    });

    await backupDoc.save();

    broadcast({
      type: 'WORLD_VERSION_UPDATED',
      payload: { version: nextVer, createdBy: backupDoc.createdByUsername, title: backupDoc.title }
    });

    res.status(201).json({
      success: true,
      message: `Backup v${nextVer} created successfully!`,
      backup: backupDoc
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/backups/:version/restore - Restore a backup to become active authoritative baseline
router.post('/:version/restore', authenticateToken, async (req, res, next) => {
  try {
    const targetVer = parseInt(req.params.version, 10);
    const targetBackup = await WorldVersion.findOne({ version: targetVer });

    if (!targetBackup) {
      return res.status(404).json({ error: 'Target backup version not found' });
    }

    // Check if session is currently online
    const activeSession = await Session.findOne({ status: { $in: ['CLAIMED', 'STARTING', 'ONLINE'] } });
    if (activeSession) {
      return res.status(400).json({ error: 'Cannot restore backup while a host session is actively running. Wait until OFFLINE.' });
    }

    const latest = await WorldVersion.findOne().sort({ version: -1 });
    const nextVer = latest ? latest.version + 1 : 100;

    // Create a new restored version bump referencing target backup archive
    const restoredDoc = new WorldVersion({
      version: nextVer,
      parentVersion: targetVer,
      title: `Restored from v${targetVer} (${targetBackup.title || 'Backup'})`,
      createdByUserId: req.user._id,
      createdByUsername: req.user.displayName || req.user.username,
      notes: `Restored world baseline from backup v${targetVer}. Original notes: ${targetBackup.notes || 'None'}`,
      fileName: targetBackup.fileName,
      fileSize: targetBackup.fileSize,
      fileUrl: targetBackup.fileUrl,
      storageType: targetBackup.storageType,
      isLocked: true,
      isAuthoritative: true
    });

    await restoredDoc.save();

    broadcast({
      type: 'WORLD_VERSION_UPDATED',
      payload: { version: nextVer, restoredFrom: targetVer }
    });

    res.json({
      success: true,
      message: `Successfully restored backup v${targetVer} as active world v${nextVer}!`,
      newVersion: nextVer
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/backups/:version/lock - Toggle Lock / Pin
router.post('/:version/lock', authenticateToken, async (req, res, next) => {
  try {
    const versionNum = parseInt(req.params.version, 10);
    const doc = await WorldVersion.findOne({ version: versionNum });
    if (!doc) {
      return res.status(404).json({ error: 'Backup not found' });
    }

    doc.isLocked = !doc.isLocked;
    await doc.save();

    res.json({
      success: true,
      version: doc.version,
      isLocked: doc.isLocked
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/backups/:version - Delete a backup
router.delete('/:version', authenticateToken, async (req, res, next) => {
  try {
    const versionNum = parseInt(req.params.version, 10);
    const doc = await WorldVersion.findOne({ version: versionNum });
    if (!doc) {
      return res.status(404).json({ error: 'Backup not found' });
    }

    if (doc.isLocked) {
      return res.status(400).json({ error: 'Cannot delete a locked / pinned backup. Unlock it first.' });
    }

    const latest = await WorldVersion.findOne().sort({ version: -1 });
    if (latest && latest.version === versionNum) {
      return res.status(400).json({ error: 'Cannot delete the currently active latest world version.' });
    }

    await WorldVersion.deleteOne({ version: versionNum });
    res.json({ success: true, message: `Backup v${versionNum} deleted.` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
