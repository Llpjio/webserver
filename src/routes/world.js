const express = require('express');
const router = express.Router();
const multer = require('multer');
const { WorldVersion } = require('../db/models');
const storageService = require('../services/storage');
const { authenticateToken } = require('../middleware/auth');
const sessionManager = require('../services/sessionManager');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 } // 2GB max
});

// GET /api/world/latest
router.get('/latest', async (req, res, next) => {
  try {
    const latest = await WorldVersion.findOne().sort({ version: -1 });
    if (!latest) return res.json({ worldVersion: null });

    const downloadUrl = await storageService.getDownloadUrl(latest.version, latest);
    res.json({
      worldVersion: {
        version: latest.version,
        parentVersion: latest.parentVersion,
        createdByUsername: latest.createdByUsername,
        notes: latest.notes,
        fileName: latest.fileName,
        fileSize: latest.fileSize,
        storageType: latest.storageType,
        downloadUrl,
        createdAt: latest.createdAt
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/world/download-url/:version
router.get('/download-url/:version', async (req, res, next) => {
  try {
    const versionNum = parseInt(req.params.version, 10);
    const doc = await WorldVersion.findOne({ version: versionNum });
    if (!doc) {
      return res.status(404).json({ error: 'World version not found' });
    }

    const downloadUrl = await storageService.getDownloadUrl(versionNum, doc);
    res.json({
      version: versionNum,
      fileName: doc.fileName || `world_v${versionNum}.zip`,
      fileSize: doc.fileSize,
      downloadUrl
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/world/download/:version (Direct download / Stream)
router.get('/download/:version', async (req, res, next) => {
  try {
    const versionNum = parseInt(req.params.version, 10);
    const doc = await WorldVersion.findOne({ version: versionNum });
    if (!doc) {
      return res.status(404).send('World version not found');
    }

    if (doc.storageType === 'gdrive' && doc.fileUrl) {
      return res.redirect(doc.fileUrl);
    }

    if (doc.storageType === 'r2' && storageService.isR2Configured()) {
      const directUrl = await storageService.getDownloadUrl(versionNum, doc);
      return res.redirect(directUrl);
    }

    // Local stream fallback
    const localPath = storageService.getLocalFilePath(versionNum, doc.fileName);
    if (localPath) {
      return res.download(localPath, doc.fileName || `world_v${versionNum}.zip`);
    }

    res.status(404).send('World archive file not found on server storage');
  } catch (err) {
    next(err);
  }
});

// POST /api/world/upload (Host uploads new world version or links Google Drive & ends session)
router.post('/upload', authenticateToken, upload.single('worldFile'), async (req, res, next) => {
  try {
    const { notes, gdriveUrl } = req.body;
    let fileInfo = null;

    // Get current version to calculate next version
    const latestVer = await WorldVersion.findOne().sort({ version: -1 });
    const currentVer = latestVer ? latestVer.version : 100;
    const nextVer = currentVer + 1;

    if (gdriveUrl && gdriveUrl.trim()) {
      fileInfo = storageService.processGoogleDriveLink(nextVer, gdriveUrl.trim());
    } else if (req.file) {
      fileInfo = await storageService.uploadWorldFile(
        nextVer,
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
    } else {
      fileInfo = {
        fileName: `world_v${nextVer}.zip`,
        fileSize: 0,
        fileUrl: storageService.GDRIVE_STORAGE_URL,
        storageType: 'gdrive'
      };
    }

    // Finalize session with file info
    const result = await sessionManager.finalizeSession(req.user, notes, fileInfo);
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// GET /api/world/history
router.get('/history', async (req, res, next) => {
  try {
    const history = await WorldVersion.find().sort({ version: -1 }).limit(30);
    res.json({
      history: history.map(w => ({
        version: w.version,
        player_name: w.createdByUsername,
        notes: w.notes,
        fileName: w.fileName,
        fileSize: w.fileSize,
        storageType: w.storageType,
        created_at: w.createdAt.toISOString()
      }))
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
