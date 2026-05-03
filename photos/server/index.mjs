import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const serverDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(serverDir, '..');
const repoDir = resolve(appDir, '..');

for (const envPath of [
  resolve(repoDir, '.env'),
  resolve(appDir, '.env'),
  resolve(appDir, '.env.local'),
]) {
  loadEnv({ path: envPath, override: false, quiet: true });
}

const PORT = readNumber('PHOTOS_PORT', readNumber('PORT', 8787));
const BUCKET = process.env.PHOTOS_S3_BUCKET || process.env.AWS_S3_BUCKET || process.env.S3_BUCKET;
const REGION = process.env.PHOTOS_AWS_REGION || process.env.AWS_REGION || 'us-east-1';
const PREFIX = normalizePrefix(process.env.PHOTOS_S3_PREFIX || 'debajyoti-photos/');
const MAX_UPLOAD_BYTES = readNumber('PHOTOS_MAX_UPLOAD_BYTES', 1024 * 1024 * 1024);
const PRESIGN_SECONDS = Math.min(readNumber('PHOTOS_PRESIGN_SECONDS', 300), 900);
const READ_URL_SECONDS = Math.min(readNumber('PHOTOS_READ_URL_SECONDS', 300), 900);
const MAX_LIST_ITEMS = Math.min(readNumber('PHOTOS_MAX_LIST_ITEMS', 120), 500);
const ALLOWED_ORIGIN = process.env.PHOTOS_ALLOWED_ORIGIN || '*';
const API_TOKEN = process.env.PHOTOS_API_TOKEN || '';
const RATE_WINDOW_MS = readNumber('PHOTOS_RATE_WINDOW_MS', 60_000);
const RATE_MAX = readNumber('PHOTOS_RATE_MAX', 120);

const s3 = new S3Client({ region: REGION });
const rateBuckets = new Map();

function readNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizePrefix(prefix) {
  const cleaned = String(prefix || '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
  return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function sendJson(res, status, body) {
  const payload = status === 204 ? '' : JSON.stringify(body);
  res.writeHead(status, {
    ...corsHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function clientId(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(req, res) {
  const id = clientId(req);
  const now = Date.now();
  const bucket = rateBuckets.get(id);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(id, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  if (bucket.count > RATE_MAX) {
    sendJson(res, 429, { error: 'Too many requests. Try again shortly.' });
    return false;
  }
  return true;
}

function authorized(req) {
  if (!API_TOKEN) return true;
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(API_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readJson(req) {
  return new Promise((resolveJson, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolveJson({});
        return;
      }
      try {
        resolveJson(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function safeName(name) {
  const cleaned = String(name || 'upload')
    .split(/[\\/]/)
    .pop()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, 'upload');
  return cleaned || 'upload';
}

function baseNameWithoutExt(name) {
  return safeName(name)
    .replace(/\.[a-z0-9]{2,8}$/i, '')
    .slice(0, 96)
    .replace(/[^a-zA-Z0-9._ -]/g, '_') || 'media';
}

function extensionFor(contentType, filename) {
  const existing = safeName(filename).match(/\.[a-z0-9]{2,8}$/i)?.[0];
  if (existing) return existing.toLowerCase();
  if (contentType === 'image/heic') return '.heic';
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  if (contentType === 'image/gif') return '.gif';
  if (contentType === 'video/quicktime') return '.mov';
  if (contentType === 'video/webm') return '.webm';
  if (contentType.startsWith('video/')) return '.mp4';
  return '.jpg';
}

function isSupportedMedia(contentType) {
  return /^image\/(jpeg|jpg|png|webp|gif|heic|heif)$/i.test(contentType)
    || /^video\/(mp4|quicktime|webm|x-m4v)$/i.test(contentType);
}

function mediaTypeFromKey(key) {
  return /\.(mp4|mov|m4v|webm)$/i.test(key) ? 'video' : 'photo';
}

function isMediaKey(key) {
  return /\.(jpe?g|png|webp|gif|heic|heif|mp4|mov|m4v|webm)$/i.test(key);
}

function assertConfigured() {
  if (!BUCKET) throw new Error('PHOTOS_S3_BUCKET or S3_BUCKET is required.');
}

async function handleUploadUrl(req, res) {
  assertConfigured();
  const body = await readJson(req);
  const filename = safeName(body.filename);
  const contentType = String(body.contentType || '').toLowerCase();
  const size = Number(body.size || 0);

  if (!isSupportedMedia(contentType)) {
    sendJson(res, 400, { error: 'Only common image and video formats can be uploaded.' });
    return;
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
    sendJson(res, 400, { error: `Upload size must be between 1 byte and ${MAX_UPLOAD_BYTES} bytes.` });
    return;
  }

  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ext = extensionFor(contentType, filename);
  const key = `${PREFIX}${yyyy}/${mm}/${randomUUID()}-${baseNameWithoutExt(filename)}${ext}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
    Metadata: {
      originalName: filename,
      source: 'debajyoti-photos',
    },
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: PRESIGN_SECONDS });

  sendJson(res, 200, {
    key,
    uploadUrl,
    expiresIn: PRESIGN_SECONDS,
    headers: { 'Content-Type': contentType },
  });
}

async function handleList(_req, res) {
  assertConfigured();
  const listed = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: PREFIX,
    MaxKeys: MAX_LIST_ITEMS,
  }));

  const objects = (listed.Contents || [])
    .filter((object) => object.Key && !object.Key.endsWith('/') && isMediaKey(object.Key))
    .sort((a, b) => (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0));

  const items = await Promise.all(objects.map(async (object) => {
    const key = object.Key;
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: READ_URL_SECONDS });
    const fileName = key.split('/').pop() || key;
    return {
      id: key,
      key,
      url,
      fileName,
      type: mediaTypeFromKey(key),
      size: object.Size || 0,
      createdAt: (object.LastModified || new Date()).toISOString(),
    };
  }));

  sendJson(res, 200, { items, prefix: PREFIX, bucket: BUCKET, region: REGION, truncated: Boolean(listed.IsTruncated) });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {});
      return;
    }
    if (!checkRateLimit(req, res)) return;

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        bucketConfigured: Boolean(BUCKET),
        tokenRequired: Boolean(API_TOKEN),
        prefix: PREFIX,
      });
      return;
    }

    if (!authorized(req)) {
      sendJson(res, 401, { error: 'Unauthorized.' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/photos/list') {
      await handleList(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/photos/upload-url') {
      await handleUploadUrl(req, res);
      return;
    }
    sendJson(res, 404, { error: 'Not found.' });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`Debajyoti Photos API listening on http://localhost:${PORT}`);
  console.log(`S3 target: ${BUCKET || '(not configured)'}/${PREFIX}`);
  console.log(`Root .env loaded for AWS credentials: ${process.env.AWS_ACCESS_KEY_ID ? 'yes' : 'no'}`);
});
