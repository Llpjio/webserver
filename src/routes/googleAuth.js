const express = require('express');
const router = express.Router();
const googleDriveService = require('../services/googleDrive');
const { GoogleAccount } = require('../db/models');
const { authenticateToken } = require('../middleware/auth');

function getRedirectUri(req) {
  const host = req.get('host');
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  return `${protocol}://${host}/api/auth/google/callback`;
}

// GET /api/auth/google - Initiate OAuth flow
router.get('/', (req, res) => {
  if (!googleDriveService.isConfigured()) {
    return res.status(500).json({ error: 'Google OAuth is not configured on this server.' });
  }

  const redirectUri = getRedirectUri(req);
  const state = req.query.state || '';
  const authUrl = googleDriveService.getAuthUrl(redirectUri, state);
  res.redirect(authUrl);
});

// GET /api/auth/google/callback - Handle OAuth callback from Google
router.get('/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    if (error) {
      console.warn('[GDrive OAuth] User denied or error occurred:', error);
      return res.redirect('/?gdrive=error&msg=' + encodeURIComponent(error));
    }

    if (!code) {
      return res.redirect('/?gdrive=error&msg=No_authorization_code_received');
    }

    const redirectUri = getRedirectUri(req);
    await googleDriveService.handleOAuthCallback(code, redirectUri);

    res.redirect('/?gdrive=connected');
  } catch (err) {
    console.error('[GDrive OAuth Callback Error]:', err);
    res.redirect('/?gdrive=error&msg=' + encodeURIComponent(err.message || 'OAuth_callback_failed'));
  }
});

// GET /api/auth/google/status - Get current Google Drive connection & storage quota
router.get('/status', async (req, res, next) => {
  try {
    const account = await googleDriveService.getActiveGoogleAccount();
    if (!account) {
      return res.json({ connected: false });
    }

    res.json({
      connected: true,
      email: account.email,
      name: account.name,
      picture: account.picture,
      folderId: account.folderId,
      folderName: account.folderName,
      storageQuota: account.storageQuota || { usage: 0, limit: 0 },
      autoBackupsEnabled: account.autoBackupsEnabled,
      lastSyncedAt: account.lastSyncedAt
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/google/disconnect - Disconnect Google Account
router.post('/disconnect', authenticateToken, async (req, res, next) => {
  try {
    await GoogleAccount.deleteMany({});
    res.json({ success: true, message: 'Google Drive account disconnected.' });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/google/toggle-auto-backups
router.post('/toggle-auto-backups', authenticateToken, async (req, res, next) => {
  try {
    const account = await googleDriveService.getActiveGoogleAccount();
    if (!account) {
      return res.status(404).json({ error: 'No connected Google account found.' });
    }

    account.autoBackupsEnabled = !account.autoBackupsEnabled;
    await account.save();

    res.json({
      success: true,
      autoBackupsEnabled: account.autoBackupsEnabled
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
