const express = require('express');
const router = express.Router();
const multer = require('multer');
const { WorldVersion, Session } = require('../db/models');
const { authenticateToken } = require('../middleware/auth');
const { broadcast } = require('../services/websocket');
const sessionManager = require('../services/sessionManager');
const googleDriveService = require('../services/googleDrive');
const storageService = require('../services/storage');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB max for delta
});

// GET /api/delta/manifest/:version - Fetch manifest for specific version
router.get('/manifest/:version', async (req, res, next) => {
  try {
    const versionNum = parseInt(req.params.version, 10);
    const doc = await WorldVersion.findOne({ version: versionNum });
    if (!doc) {
      return res.status(404).json({ error: `World version ${versionNum} not found` });
    }

    res.json({
      version: doc.version,
      manifest: doc.manifest || {},
      totalFiles: doc.totalFiles || Object.keys(doc.manifest || {}).length,
      createdAt: doc.createdAt
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/delta/latest - Fetch latest authoritative world version + delta info
router.get('/latest', async (req, res, next) => {
  try {
    const latest = await WorldVersion.findOne().sort({ version: -1 });
    if (!latest) {
      return res.json({ worldVersion: null });
    }

    const downloadUrl = await storageService.getDownloadUrl(latest.version, latest);

    res.json({
      version: latest.version,
      parentVersion: latest.parentVersion,
      createdBy: latest.createdByUsername,
      notes: latest.notes,
      fileName: latest.fileName,
      fileSize: latest.fileSize,
      storageType: latest.storageType,
      gdriveFileId: latest.gdriveFileId,
      deltaFileUrl: latest.deltaFileUrl,
      deltaFileName: latest.deltaFileName,
      deltaFileSize: latest.deltaFileSize || 0,
      deltaChangedFilesCount: latest.deltaChangedFilesCount || 0,
      totalFiles: latest.totalFiles || Object.keys(latest.manifest || {}).length,
      hasManifest: !!(latest.manifest && Object.keys(latest.manifest).length > 0),
      downloadUrl,
      createdAt: latest.createdAt
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/delta/diff - Compute file differences between two versions
router.get('/diff', async (req, res, next) => {
  try {
    const fromVer = parseInt(req.query.fromVersion, 10);
    let toVer = req.query.toVersion ? parseInt(req.query.toVersion, 10) : null;

    if (!fromVer || isNaN(fromVer)) {
      return res.status(400).json({ error: 'fromVersion query parameter is required (e.g. ?fromVersion=100)' });
    }

    let toDoc = null;
    if (toVer) {
      toDoc = await WorldVersion.findOne({ version: toVer });
    } else {
      toDoc = await WorldVersion.findOne().sort({ version: -1 });
    }

    if (!toDoc) {
      return res.status(404).json({ error: 'Target world version not found' });
    }

    toVer = toDoc.version;
    if (fromVer === toVer) {
      return res.json({
        upToDate: true,
        fromVersion: fromVer,
        toVersion: toVer,
        changedFiles: [],
        deletedFiles: [],
        unchangedCount: Object.keys(toDoc.manifest || {}).length
      });
    }

    const fromDoc = await WorldVersion.findOne({ version: fromVer });
    const fromManifest = (fromDoc && fromDoc.manifest) ? fromDoc.manifest : {};
    const toManifest = toDoc.manifest || {};

    const changed = [];
    const deleted = [];
    let unchangedCount = 0;
    let transferBytes = 0;

    // Check files in target version vs local version
    for (const [filePath, fileInfo] of Object.entries(toManifest)) {
      const fromFile = fromManifest[filePath];
      if (!fromFile || fromFile.sha256 !== fileInfo.sha256) {
        changed.push({
          path: filePath,
          sha256: fileInfo.sha256,
          size: fileInfo.size || 0,
          isNew: !fromFile
        });
        transferBytes += (fileInfo.size || 0);
      } else {
        unchangedCount++;
      }
    }

    // Check deleted files
    for (const filePath of Object.keys(fromManifest)) {
      if (!toManifest[filePath]) {
        deleted.push(filePath);
      }
    }

    res.json({
      upToDate: false,
      fromVersion: fromVer,
      toVersion: toVer,
      changedFiles: changed,
      changedCount: changed.length,
      deletedFiles: deleted,
      deletedCount: deleted.length,
      unchangedCount,
      totalTargetFiles: Object.keys(toManifest).length,
      totalTransferBytes: transferBytes,
      deltaFileUrl: toDoc.deltaFileUrl,
      deltaFileSize: toDoc.deltaFileSize || transferBytes,
      fullDownloadUrl: await storageService.getDownloadUrl(toVer, toDoc)
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/delta/publish - Publish a new world version with delta manifest
router.post('/publish', authenticateToken, upload.single('deltaFile'), async (req, res, next) => {
  try {
    const { notes, manifestJson, deltaFileName, deltaChangedFilesCount, totalFiles } = req.body;

    let manifest = {};
    if (manifestJson) {
      try {
        manifest = typeof manifestJson === 'string' ? JSON.parse(manifestJson) : manifestJson;
      } catch (e) {
        return res.status(400).json({ error: 'Invalid manifestJson format' });
      }
    }

    const latest = await WorldVersion.findOne().sort({ version: -1 });
    const currentVer = latest ? latest.version : 100;
    const nextVer = currentVer + 1;

    let deltaUrl = null;
    let deltaSize = 0;
    let gdriveFileId = null;

    const googleAccount = await googleDriveService.getActiveGoogleAccount();

    // If client uploaded a delta zip directly
    if (req.file) {
      deltaSize = req.file.size || req.file.buffer.length;
      if (googleAccount) {
        try {
          const driveRes = await googleDriveService.uploadWorldToDrive(
            nextVer,
            req.file.buffer,
            deltaFileName || `delta_v${currentVer}_to_v${nextVer}.zip`,
            notes || `Incremental Delta v${currentVer} -> v${nextVer}`,
            googleAccount
          );
          deltaUrl = driveRes.webViewLink;
          gdriveFileId = driveRes.fileId;
        } catch (dErr) {
          console.warn('[Delta GDrive Upload Error]', dErr.message);
        }
      }
    }

    const newDoc = new WorldVersion({
      version: nextVer,
      parentVersion: currentVer,
      title: `World Save (v${nextVer})`,
      createdByUserId: req.user._id,
      createdByUsername: req.user.displayName || req.user.username,
      notes: notes && notes.trim() ? notes.trim() : 'Session delta synced',
      fileName: `world_v${nextVer}.zip`,
      fileSize: 0,
      storageType: gdriveFileId ? 'gdrive' : 'none',
      gdriveFileId,
      manifest,
      deltaFileUrl: deltaUrl,
      deltaFileName: deltaFileName || `delta_v${currentVer}_to_v${nextVer}.zip`,
      deltaFileSize: deltaSize,
      deltaChangedFilesCount: parseInt(deltaChangedFilesCount || '0', 10),
      totalFiles: parseInt(totalFiles || Object.keys(manifest).length || '0', 10),
      isLocked: false,
      isAuthoritative: true
    });

    await newDoc.save();

    // Reset active session if current user is host
    const activeSession = await Session.findOne({ status: { $in: ['CLAIMED', 'STARTING', 'ONLINE', 'SAVING'] } });
    if (activeSession && activeSession.hostUserId.toString() === req.user._id.toString()) {
      activeSession.status = 'OFFLINE';
      activeSession.worldVersionEnd = nextVer;
      activeSession.sessionEndedAt = new Date();
      await activeSession.save();
    }

    broadcast({
      type: 'WORLD_VERSION_UPDATED',
      payload: { 
        version: nextVer, 
        createdBy: newDoc.createdByUsername, 
        deltaFiles: newDoc.deltaChangedFilesCount,
        deltaSize: newDoc.deltaFileSize
      }
    });

    res.status(201).json({
      success: true,
      message: `World version v${nextVer} published with delta manifest (${newDoc.deltaChangedFilesCount} changed files)!`,
      newVersion: nextVer,
      deltaFileSize: newDoc.deltaFileSize,
      totalFiles: newDoc.totalFiles
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
