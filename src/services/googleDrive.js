const { google } = require('googleapis');
const { Readable } = require('stream');
const { GoogleAccount } = require('../db/models');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/drive.file'
];

function isConfigured() {
  return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

function getOAuth2Client(redirectUri) {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

function getAuthUrl(redirectUri, state) {
  const oauth2Client = getOAuth2Client(redirectUri);
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state: state || ''
  });
}

/**
 * Handle OAuth code exchange and register Google Account
 */
async function handleOAuthCallback(code, redirectUri, userId = null) {
  const oauth2Client = getOAuth2Client(redirectUri);
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Fetch User Info
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const userInfoRes = await oauth2.userinfo.get();
  const userInfo = userInfoRes.data;

  // Initialize Drive
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  // Get or Create dedicated 'E4ALL Backups' folder
  const folderInfo = await getOrCreateBackupsFolder(drive, 'E4ALL Backups');

  // Fetch Drive Storage Quota
  let storageQuota = { usage: 0, limit: 0 };
  try {
    const aboutRes = await drive.about.get({ fields: 'storageQuota' });
    if (aboutRes.data && aboutRes.data.storageQuota) {
      storageQuota = {
        usage: parseInt(aboutRes.data.storageQuota.usage || '0', 10),
        limit: parseInt(aboutRes.data.storageQuota.limit || '0', 10)
      };
    }
  } catch (qErr) {
    console.warn('[GDrive] Could not fetch storage quota:', qErr.message);
  }

  // Upsert GoogleAccount doc
  let account = await GoogleAccount.findOne({ email: userInfo.email });
  if (!account) {
    account = new GoogleAccount({
      email: userInfo.email,
      name: userInfo.name || userInfo.email,
      picture: userInfo.picture || '',
      tokens,
      folderId: folderInfo.id,
      folderName: 'E4ALL Backups',
      storageQuota,
      connectedByUserId: userId,
      lastSyncedAt: new Date()
    });
  } else {
    account.name = userInfo.name || account.name;
    account.picture = userInfo.picture || account.picture;
    account.tokens = { ...account.tokens, ...tokens };
    account.folderId = folderInfo.id || account.folderId;
    account.storageQuota = storageQuota;
    account.lastSyncedAt = new Date();
    if (userId) account.connectedByUserId = userId;
  }

  await account.save();
  return { account, folderInfo };
}

/**
 * Get the active connected Google Account
 */
async function getActiveGoogleAccount() {
  return await GoogleAccount.findOne().sort({ lastSyncedAt: -1 });
}

/**
 * Build authenticated Google Drive client for an account
 */
function getAuthenticatedDriveClient(account) {
  if (!account || !account.tokens) return null;

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(account.tokens);

  oauth2Client.on('tokens', async (newTokens) => {
    try {
      account.tokens = { ...account.tokens, ...newTokens };
      await account.save();
    } catch (err) {
      console.error('[GDrive] Failed to persist refreshed tokens:', err);
    }
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Get or create the E4ALL Backups folder in user's Drive
 */
async function getOrCreateBackupsFolder(drive, folderName = 'E4ALL Backups') {
  try {
    const res = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`,
      fields: 'files(id, name, webViewLink)',
      spaces: 'drive'
    });

    if (res.data.files && res.data.files.length > 0) {
      return res.data.files[0];
    }

    // Create folder
    const createRes = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        description: 'Automatic Minecraft World Backups for E4ALL'
      },
      fields: 'id, name, webViewLink'
    });

    return createRes.data;
  } catch (err) {
    console.error('[GDrive] Error getting or creating backups folder:', err);
    throw err;
  }
}

/**
 * Upload a world zip file directly to Google Drive
 */
async function uploadWorldToDrive(version, fileBuffer, fileName, notes, account) {
  const targetAccount = account || await getActiveGoogleAccount();
  if (!targetAccount) {
    throw new Error('No connected Google Drive account found.');
  }

  const drive = getAuthenticatedDriveClient(targetAccount);
  if (!drive) {
    throw new Error('Failed to authenticate with Google Drive.');
  }

  const targetFileName = fileName || `world_v${version}.zip`;
  let folderId = targetAccount.folderId;

  if (!folderId) {
    const folder = await getOrCreateBackupsFolder(drive, targetAccount.folderName || 'E4ALL Backups');
    folderId = folder.id;
    targetAccount.folderId = folderId;
    await targetAccount.save();
  }

  const readableStream = new Readable();
  readableStream.push(fileBuffer);
  readableStream.push(null);

  const fileMetadata = {
    name: targetFileName,
    parents: [folderId],
    description: notes || `E4ALL World Backup v${version}`
  };

  const media = {
    mimeType: 'application/zip',
    body: readableStream
  };

  const uploadRes = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id, name, size, webViewLink, webContentLink, createdTime'
  });

  const fileData = uploadRes.data;
  console.log(`[GDrive] Successfully uploaded ${targetFileName} (ID: ${fileData.id}) to Google Drive folder!`);

  // Update storage quota
  try {
    const quotaRes = await drive.about.get({ fields: 'storageQuota' });
    if (quotaRes.data && quotaRes.data.storageQuota) {
      targetAccount.storageQuota = {
        usage: parseInt(quotaRes.data.storageQuota.usage || '0', 10),
        limit: parseInt(quotaRes.data.storageQuota.limit || '0', 10)
      };
      await targetAccount.save();
    }
  } catch (e) {
    // Quota refresh fail is non-fatal
  }

  return {
    fileId: fileData.id,
    fileName: fileData.name,
    fileSize: parseInt(fileData.size || fileBuffer.length || '0', 10),
    webViewLink: fileData.webViewLink || `https://drive.google.com/file/d/${fileData.id}/view`,
    downloadUrl: `/api/world/download/${version}`,
    folderId
  };
}

/**
 * Get read stream for downloading from Google Drive
 */
async function getDriveDownloadStream(fileId, account) {
  const targetAccount = account || await getActiveGoogleAccount();
  if (!targetAccount) return null;

  const drive = getAuthenticatedDriveClient(targetAccount);
  if (!drive) return null;

  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  return res.data;
}

/**
 * Delete a backup file from Google Drive
 */
async function deleteDriveFile(fileId, account) {
  if (!fileId) return;
  const targetAccount = account || await getActiveGoogleAccount();
  if (!targetAccount) return;

  const drive = getAuthenticatedDriveClient(targetAccount);
  if (!drive) return;

  try {
    await drive.files.delete({ fileId });
    console.log(`[GDrive] Deleted file ${fileId} from Google Drive.`);
  } catch (err) {
    console.warn(`[GDrive] Could not delete file ${fileId}:`, err.message);
  }
}

module.exports = {
  isConfigured,
  getAuthUrl,
  handleOAuthCallback,
  getActiveGoogleAccount,
  getOrCreateBackupsFolder,
  uploadWorldToDrive,
  getDriveDownloadStream,
  deleteDriveFile
};
