const path = require('path');
const fs = require('fs');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let s3Client = null;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'e4all-worlds';
const R2_PUBLIC_DOMAIN = process.env.R2_PUBLIC_DOMAIN; // e.g. https://pub-xxx.r2.dev

const GDRIVE_STORAGE_URL = process.env.GDRIVE_STORAGE_URL || 'https://drive.google.com/drive/folders/1SStfXqC6bhod_kHJ4bOnQ0Yx6UtrJ7H0?usp=sharing';

const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

function isR2Configured() {
  return !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
}

function getGDriveStorageUrl() {
  return GDRIVE_STORAGE_URL;
}

if (isR2Configured()) {
  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY
    }
  });
  console.log(`[Storage] Cloudflare R2 initialized with bucket: ${R2_BUCKET_NAME}`);
} else {
  console.log(`[Storage] Cloudflare R2 credentials not provided in .env. Using local storage at ${uploadsDir}`);
}

/**
 * Parse a Google Drive share link and return direct download and view URLs
 */
function parseGoogleDriveUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  const trimmed = rawUrl.trim();
  let fileId = null;

  // Patterns: /file/d/FILE_ID/..., id=FILE_ID, /open?id=FILE_ID
  const matchFileD = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (matchFileD) {
    fileId = matchFileD[1];
  } else {
    const matchIdParam = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (matchIdParam) {
      fileId = matchIdParam[1];
    }
  }

  if (!fileId) return null;

  return {
    fileId,
    // Google Drive direct download URL format
    downloadUrl: `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0`,
    fallbackDownloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
    viewUrl: `https://drive.google.com/file/d/${fileId}/view`
  };
}

/**
 * Process a Google Drive link provided by host for a world version
 */
function processGoogleDriveLink(version, rawUrl, notes) {
  const parsed = parseGoogleDriveUrl(rawUrl);
  if (!parsed) {
    throw new Error('Invalid Google Drive link. Please provide a valid share link from Google Drive (e.g., https://drive.google.com/file/d/xxx/view).');
  }

  return {
    fileName: `world_v${version}.zip`,
    fileSize: 0,
    fileUrl: parsed.downloadUrl,
    storageType: 'gdrive'
  };
}

/**
 * Upload a world archive (to R2 if configured, otherwise locally)
 */
async function uploadWorldFile(version, fileBuffer, originalName, mimeType) {
  const fileName = `world_v${version}.zip`;
  const fileSize = fileBuffer.length;

  if (isR2Configured() && s3Client) {
    const key = `worlds/${fileName}`;
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType || 'application/zip'
    });

    await s3Client.send(command);
    console.log(`[Storage] Uploaded ${fileName} (${fileSize} bytes) to Cloudflare R2.`);

    const fileUrl = R2_PUBLIC_DOMAIN 
      ? `${R2_PUBLIC_DOMAIN.replace(/\/$/, '')}/${key}`
      : `r2://${R2_BUCKET_NAME}/${key}`;

    return {
      fileName,
      fileSize,
      fileUrl,
      storageType: 'r2'
    };
  } else {
    // Local storage fallback
    const destPath = path.join(uploadsDir, fileName);
    fs.writeFileSync(destPath, fileBuffer);
    console.log(`[Storage] Saved ${fileName} (${fileSize} bytes) to local storage.`);

    return {
      fileName,
      fileSize,
      fileUrl: `/api/world/download/${version}`,
      storageType: 'local'
    };
  }
}

/**
 * Get direct / pre-signed download link for a world version
 */
async function getDownloadUrl(version, worldDoc) {
  if (!worldDoc) return null;

  if (worldDoc.storageType === 'gdrive' && worldDoc.fileUrl) {
    return worldDoc.fileUrl;
  }

  if (worldDoc.storageType === 'r2' && isR2Configured() && s3Client) {
    if (R2_PUBLIC_DOMAIN) {
      return `${R2_PUBLIC_DOMAIN.replace(/\/$/, '')}/worlds/${worldDoc.fileName || `world_v${version}.zip`}`;
    }

    const command = new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: `worlds/${worldDoc.fileName || `world_v${version}.zip`}`
    });

    // Generate pre-signed URL valid for 2 hours
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 7200 });
    return presignedUrl;
  }

  // Fallback to local / direct endpoint
  return `/api/world/download/${version}`;
}

/**
 * Get local file path for streaming download if stored locally
 */
function getLocalFilePath(version, fileName) {
  const target = fileName || `world_v${version}.zip`;
  const filePath = path.join(uploadsDir, target);
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  return null;
}

module.exports = {
  GDRIVE_STORAGE_URL,
  getGDriveStorageUrl,
  isR2Configured,
  parseGoogleDriveUrl,
  processGoogleDriveLink,
  uploadWorldFile,
  getDownloadUrl,
  getLocalFilePath
};
