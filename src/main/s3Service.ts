import {
  S3Client,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  RestoreObjectCommand,
  CopyObjectCommand,
  PutBucketVersioningCommand,
  GetBucketLocationCommand
} from '@aws-sdk/client-s3';
import { GetProductsCommand, PricingClient } from '@aws-sdk/client-pricing';
import archiver from 'archiver';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, createWriteStream, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import type { AwsCredentialIdentity, Provider } from '@aws-sdk/types';
import { fromEnv, fromIni } from '@aws-sdk/credential-providers';
import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';
import {
  AppConfig,
  BucketAnalytics,
  FolderInfo,
  PhotoLibraryItem,
  PhotoLibraryResult,
  RestoreRequest,
  S3Object,
  S3ObjectVersion,
  StorageClass,
  TierStats,
  UploadProgress
} from '@shared/types';

// Load .env from the project root (works in both dev and packaged app)
loadEnv({ path: join(__dirname, '../../.env') });

// S3 multipart limits: 5 MB min part, 5 GB max part, 10,000 max parts, 5 TB max object.
const MIN_PART_SIZE  = 5   * 1024 * 1024;
const MAX_PART_SIZE  = 5   * 1024 * 1024 * 1024;
const MAX_PARTS      = 9_900; // leave headroom below S3's 10,000 limit
const MAX_IN_FLIGHT  = 512  * 1024 * 1024; // cap concurrent data in memory (~512 MB)

function partSizeFor(fileSize: number): number {
  const needed = Math.ceil(fileSize / MAX_PARTS);
  return Math.min(MAX_PART_SIZE, Math.max(MIN_PART_SIZE, needed));
}

function queueSizeFor(partSize: number): number {
  // Keep concurrent in-flight data under MAX_IN_FLIGHT; at least 1, at most 4.
  return Math.max(1, Math.min(4, Math.floor(MAX_IN_FLIGHT / partSize)));
}

interface LocalUploadRequest {
  localPath: string;
  key: string;
  storageClass: StorageClass;
}

type StoragePriceTier = {
  beginRange: number;
  endRange: number;
  pricePerGBMonth: number;
  description: string;
};

type StoragePricingCatalog = {
  source: 'aws-pricing-api' | 'static-fallback';
  asOf: string;
  tiersByClass: Record<string, StoragePriceTier[]>;
  error?: string;
};

function requireFolderPrefix(prefix: string): string {
  const normalized = String(prefix ?? '').replace(/\\/g, '/');
  if (!normalized || normalized === '/' || !normalized.endsWith('/')) {
    throw new Error('Refusing folder operation without a non-empty folder prefix.');
  }
  return normalized;
}

function normalizePhotoPrefix(prefix: string): string {
  const normalized = String(prefix || 'debajyoti-photos/')
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/');
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function isPhotoLibraryKey(key: string): boolean {
  return /\.(jpe?g|png|webp|gif|heic|heif|mp4|mov|m4v|webm)$/i.test(key);
}

function photoTypeFromKey(key: string): 'photo' | 'video' {
  return /\.(mp4|mov|m4v|webm)$/i.test(key) ? 'video' : 'photo';
}

export class S3Service {
  private client: S3Client;
  private credentials: AwsCredentialIdentity | Provider<AwsCredentialIdentity>;
  private bucket: string;
  private region: string;
  private activeUploads = new Map<string, Upload>();
  private static pricingCache = new Map<string, { expiresAt: number; catalog: StoragePricingCatalog }>();

  constructor(config: AppConfig) {
    this.bucket = config.bucket;
    this.region = config.region;
    // Use explicit providers so the SDK never falls through to EC2 IMDS,
    // which hangs indefinitely on non-EC2 machines.
    this.credentials = (config.accessKeyId && config.secretAccessKey)
      ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
      : config.profile
        ? fromIni({ profile: config.profile })
        : (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
          ? fromEnv()
          : fromIni(); // reads ~/.aws/credentials default profile only
    this.client = new S3Client({ region: config.region, credentials: this.credentials });
  }

  /**
   * List objects under a prefix. We treat "/" as the folder separator
   * since S3 has no real folders — this is just a UX convention.
   */
  async list(prefix = ''): Promise<{ folders: FolderInfo[]; files: S3Object[] }> {
    const folderPrefixes: string[] = [];
    const files: S3Object[] = [];
    let continuationToken: string | undefined;

    do {
      const res = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        Delimiter: '/',
        ContinuationToken: continuationToken
      }));

      for (const cp of res.CommonPrefixes ?? []) {
        if (cp.Prefix) folderPrefixes.push(cp.Prefix);
      }
      for (const obj of res.Contents ?? []) {
        if (!obj.Key || obj.Key === prefix) continue;
        files.push({
          key: obj.Key,
          size: obj.Size ?? 0,
          lastModified: (obj.LastModified ?? new Date()).toISOString(),
          storageClass: obj.StorageClass ?? 'STANDARD',
          etag: obj.ETag
        });
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);

    // Fetch folder stats in parallel (capped at 500 objects each)
    const folders = await Promise.all(folderPrefixes.map(async (fp): Promise<FolderInfo> => {
      try {
        const r = await this.client.send(new ListObjectsV2Command({
          Bucket: this.bucket, Prefix: fp, MaxKeys: 500
        }));
        let size = 0, lastModified = '';
        for (const obj of r.Contents ?? []) {
          size += obj.Size ?? 0;
          const m = (obj.LastModified ?? new Date()).toISOString();
          if (m > lastModified) lastModified = m;
        }
        return {
          prefix: fp,
          size,
          count: r.Contents?.length ?? 0,
          lastModified: lastModified || new Date(0).toISOString(),
          capped: !!r.IsTruncated,
        };
      } catch {
        return { prefix: fp, size: 0, count: 0, lastModified: new Date(0).toISOString(), capped: false };
      }
    }));

    return { folders, files };
  }

  /**
   * Search across the entire bucket by listing everything and filtering client-side.
   * For real Drive-scale search you'd want OpenSearch or S3 Inventory + Athena,
   * but for v1 this works up to a few thousand objects.
   */
  async search(query: string): Promise<S3Object[]> {
    const lower = query.toLowerCase();
    const matches: S3Object[] = [];
    let continuationToken: string | undefined;

    do {
      const res = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        ContinuationToken: continuationToken,
        MaxKeys: 1000
      }));

      for (const obj of res.Contents ?? []) {
        if (!obj.Key || obj.Key.endsWith('/')) continue;
        if (obj.Key.toLowerCase().includes(lower)) {
          matches.push({
            key: obj.Key,
            size: obj.Size ?? 0,
            lastModified: (obj.LastModified ?? new Date()).toISOString(),
            storageClass: obj.StorageClass ?? 'STANDARD',
            etag: obj.ETag
          });
        }
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken && matches.length < 500); // hard cap

    return matches;
  }

  async listPhotos(prefix = 'debajyoti-photos/', maxItems = 160): Promise<PhotoLibraryResult> {
    const normalizedPrefix = normalizePhotoPrefix(prefix);
    const items: S3Object[] = [];
    let continuationToken: string | undefined;
    let truncated = false;

    do {
      const res = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: normalizedPrefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }));

      for (const obj of res.Contents ?? []) {
        if (!obj.Key || obj.Key.endsWith('/') || !isPhotoLibraryKey(obj.Key)) continue;
        items.push({
          key: obj.Key,
          size: obj.Size ?? 0,
          lastModified: (obj.LastModified ?? new Date()).toISOString(),
          storageClass: obj.StorageClass ?? 'STANDARD',
          etag: obj.ETag,
        });
      }

      truncated = Boolean(res.IsTruncated);
      continuationToken = res.IsTruncated && items.length < maxItems ? res.NextContinuationToken : undefined;
    } while (continuationToken);

    const sorted = items
      .sort((a, b) => b.lastModified.localeCompare(a.lastModified))
      .slice(0, maxItems);

    const photoItems: PhotoLibraryItem[] = await Promise.all(sorted.map(async item => {
      const url = await this.presign(item.key, 300);
      return {
        id: item.key,
        key: item.key,
        url,
        fileName: item.key.split('/').pop() || item.key,
        type: photoTypeFromKey(item.key),
        size: item.size,
        createdAt: item.lastModified,
      };
    }));

    return {
      items: photoItems,
      prefix: normalizedPrefix,
      truncated,
    };
  }

  /**
   * Upload with progress callbacks. Uses multipart for files >= 5 MB.
   * The user-chosen storage class is set at upload time — this is the cheap path.
   * Changing storage class later requires a CopyObject (we expose that separately).
   */
  async upload(
    req: LocalUploadRequest,
    onProgress: (p: UploadProgress) => void
  ): Promise<void> {
    const stat = statSync(req.localPath);
    const stream = createReadStream(req.localPath);

    const uploader = new Upload({
      client: this.client,
      partSize: partSizeFor(stat.size),
      queueSize: queueSizeFor(partSizeFor(stat.size)),
      params: {
        Bucket: this.bucket,
        Key: req.key,
        Body: stream,
        StorageClass: req.storageClass
      }
    });

    this.activeUploads.set(req.key, uploader);

    uploader.on('httpUploadProgress', (p) => {
      onProgress({
        key: req.key,
        loaded: p.loaded ?? 0,
        total: p.total ?? stat.size,
        done: false
      });
    });

    try {
      await uploader.done();
      this.activeUploads.delete(req.key);
      onProgress({ key: req.key, loaded: stat.size, total: stat.size, done: true });
    } catch (err) {
      this.activeUploads.delete(req.key);
      const cancelled = (err as any)?.name === 'AbortError'
        || (err as any)?.name === 'RequestAbortedError'
        || String(err).toLowerCase().includes('aborted');
      onProgress({
        key: req.key,
        loaded: 0,
        total: stat.size,
        done: true,
        error: cancelled ? 'Cancelled' : err instanceof Error ? err.message : String(err)
      });
      if (!cancelled) throw err;
    }
  }

  async uploadStream(
    key: string,
    body: Readable,
    size: number,
    storageClass: StorageClass,
    onProgress: (p: UploadProgress) => void
  ): Promise<void> {
    const uploader = new Upload({
      client: this.client,
      partSize: partSizeFor(size),
      queueSize: queueSizeFor(partSizeFor(size)),
      params: { Bucket: this.bucket, Key: key, Body: body, StorageClass: storageClass }
    });

    this.activeUploads.set(key, uploader);

    uploader.on('httpUploadProgress', (p) => {
      onProgress({ key, loaded: p.loaded ?? 0, total: p.total ?? size, done: false });
    });

    try {
      await uploader.done();
      this.activeUploads.delete(key);
      onProgress({ key, loaded: size, total: size, done: true });
    } catch (err) {
      this.activeUploads.delete(key);
      const cancelled = (err as any)?.name === 'AbortError'
        || (err as any)?.name === 'RequestAbortedError'
        || String(err).toLowerCase().includes('aborted');
      onProgress({ key, loaded: 0, total: size, done: true, error: cancelled ? 'Cancelled' : err instanceof Error ? err.message : String(err) });
      if (!cancelled) throw err;
    }
  }

  cancelUpload(key: string): void {
    const uploader = this.activeUploads.get(key);
    if (uploader) {
      uploader.abort();
      this.activeUploads.delete(key);
    }
  }

  /** Recursively delete all objects under a prefix. Returns deleted count. */
  async deleteFolder(prefix: string): Promise<number> {
    const folderPrefix = requireFolderPrefix(prefix);
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket, Prefix: folderPrefix, ContinuationToken: token
      }));
      for (const obj of res.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key);
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);

    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      await this.client.send(new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: batch.map(k => ({ Key: k })), Quiet: true }
      }));
    }
    return keys.length;
  }

  /** Download specific S3 keys (by exact key) into a single zip file. */
  async downloadKeysAsZip(
    keys: string[],
    destPath: string,
    onProgress: (p: UploadProgress) => void,
    jobKey: string
  ): Promise<void> {
    const arc = archiver('zip', { zlib: { level: 5 } });
    const output = createWriteStream(destPath);
    const closed = new Promise<void>((res, rej) => {
      output.on('close', res);
      output.on('error', rej);
      arc.on('error', rej);
    });
    arc.pipe(output);

    let loadedBytes = 0;
    let totalBytes = 0;

    for (const key of keys) {
      const getRes = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!getRes.Body) continue;
      totalBytes += getRes.ContentLength ?? 0;

      const fileName = key.split('/').pop() || key.replace(/\//g, '_');
      const body = getRes.Body as Readable;

      const tracker = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          loadedBytes += chunk.length;
          onProgress({ key: jobKey, loaded: loadedBytes, total: Math.max(totalBytes, loadedBytes), done: false });
          cb(null, chunk);
        }
      });

      await new Promise<void>((resolve, reject) => {
        tracker.on('end', resolve);
        tracker.on('error', reject);
        arc.append(tracker, { name: fileName });
        body.pipe(tracker);
      });
    }

    await arc.finalize();
    await closed;
    onProgress({ key: jobKey, loaded: totalBytes || loadedBytes, total: totalBytes || loadedBytes, done: true });
  }

  /** Stream all objects under the given prefixes into a single zip file. */
  async downloadFoldersAsZip(
    prefixes: string[],
    destPath: string,
    onProgress: (p: UploadProgress) => void,
    jobKey: string
  ): Promise<void> {
    const folderPrefixes = prefixes.map(requireFolderPrefix);
    // List all objects across all prefixes
    const objects: { key: string; size: number }[] = [];
    for (const prefix of folderPrefixes) {
      let token: string | undefined;
      do {
        const res = await this.client.send(new ListObjectsV2Command({
          Bucket: this.bucket, Prefix: prefix, ContinuationToken: token
        }));
        for (const obj of res.Contents ?? []) {
          if (obj.Key && !obj.Key.endsWith('/'))
            objects.push({ key: obj.Key, size: obj.Size ?? 0 });
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
    }

    const totalBytes = objects.reduce((s, o) => s + o.size, 0);
    let loadedBytes = 0;

    const arc = archiver('zip', { zlib: { level: 5 } });
    const output = createWriteStream(destPath);
    const closed = new Promise<void>((res, rej) => {
      output.on('close', res);
      output.on('error', rej);
      arc.on('error', rej);
    });
    arc.pipe(output);

    // Common prefix to strip so zip paths are relative
    const commonPrefix = folderPrefixes.length === 1 ? folderPrefixes[0] : '';

    for (const obj of objects) {
      const getRes = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: obj.key }));
      if (!getRes.Body) continue;

      const zipPath = commonPrefix ? obj.key.slice(commonPrefix.length) : obj.key;
      const body = getRes.Body as Readable;

      // Count bytes as they stream through before handing to archiver
      const tracker = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          loadedBytes += chunk.length;
          onProgress({ key: jobKey, loaded: loadedBytes, total: totalBytes, done: false });
          cb(null, chunk);
        }
      });

      // Wait for this file's stream to be fully piped before fetching next
      await new Promise<void>((resolve, reject) => {
        tracker.on('end', resolve);
        tracker.on('error', reject);
        arc.append(tracker, { name: zipPath });
        body.pipe(tracker);
      });
    }

    await arc.finalize();
    await closed;
    onProgress({ key: jobKey, loaded: totalBytes, total: totalBytes, done: true });
  }

  /**
   * Download an object to a local path. Streams to disk so we don't load
   * giant files into memory.
   */
  async download(
    key: string,
    localPath: string,
    versionId?: string,
    onProgress?: (p: UploadProgress) => void
  ): Promise<void> {
    const res = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      VersionId: versionId
    }));

    if (!res.Body) throw new Error('Empty response body');
    const body = res.Body as Readable;
    const total = res.ContentLength ?? 0;
    let loaded = 0;

    if (onProgress && total > 0) {
      const tracker = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          loaded += chunk.length;
          onProgress({ key, loaded, total, done: false });
          cb(null, chunk);
        }
      });
      await pipeline(body, tracker, createWriteStream(localPath));
    } else {
      await pipeline(body, createWriteStream(localPath));
    }

    onProgress?.({ key, loaded: total || loaded, total: total || loaded, done: true });
  }

  /**
   * Generate a pre-signed URL for sharing. Default expiry is 1 hour;
   * AWS caps this at 7 days for SigV4 with IAM user credentials.
   */
  async presign(key: string, expiresInSeconds = 3600): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, cmd, { expiresIn: expiresInSeconds });
  }

  async delete(key: string, versionId?: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
      VersionId: versionId
    }));
  }

  /**
   * List all versions of a key. Requires bucket versioning to be enabled —
   * if it isn't, you'll only get the current version.
   */
  async listVersions(key: string): Promise<S3ObjectVersion[]> {
    const res = await this.client.send(new ListObjectVersionsCommand({
      Bucket: this.bucket,
      Prefix: key
    }));

    return (res.Versions ?? [])
      .filter(v => v.Key === key)
      .map(v => ({
        key: v.Key!,
        versionId: v.VersionId ?? 'null',
        size: v.Size ?? 0,
        lastModified: (v.LastModified ?? new Date()).toISOString(),
        isLatest: v.IsLatest ?? false,
        storageClass: v.StorageClass ?? 'STANDARD'
      }));
  }

  /**
   * Restore an old version by copying it on top of the current key.
   * S3 doesn't have "make this version current" — copy-self is the idiom.
   */
  async restoreVersion(key: string, versionId: string): Promise<void> {
    await this.client.send(new CopyObjectCommand({
      Bucket: this.bucket,
      Key: key,
      CopySource: `${this.bucket}/${encodeURIComponent(key)}?versionId=${versionId}`
    }));
  }

  /**
   * For Glacier / Deep Archive objects: initiate a restore so the data
   * becomes temporarily downloadable. This does NOT change the storage class —
   * it creates a temporary copy in Standard for `days` days.
   */
  async initiateGlacierRestore(req: RestoreRequest): Promise<void> {
    await this.client.send(new RestoreObjectCommand({
      Bucket: this.bucket,
      Key: req.key,
      VersionId: req.versionId,
      RestoreRequest: {
        Days: req.days,
        GlacierJobParameters: { Tier: req.tier }
      }
    }));
  }

  /**
   * Check the restore status of an archived object.
   * Returns { ongoing: boolean, expiry?: Date }
   */
  async checkRestoreStatus(key: string, versionId?: string): Promise<{
    ongoing: boolean;
    expiry?: string;
    storageClass?: string;
  }> {
    const res = await this.client.send(new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
      VersionId: versionId
    }));

    // The Restore header looks like: ongoing-request="false", expiry-date="Wed, 21 Oct 2026 07:28:00 GMT"
    const restoreHeader = res.Restore ?? '';
    const ongoing = restoreHeader.includes('ongoing-request="true"');
    const expiryMatch = restoreHeader.match(/expiry-date="([^"]+)"/);

    return {
      ongoing,
      expiry: expiryMatch ? new Date(expiryMatch[1]).toISOString() : undefined,
      storageClass: res.StorageClass ?? 'STANDARD'
    };
  }

  /**
   * Change the storage class of an existing object via copy-in-place.
   * The new storage class only applies to the new copy.
   */
  async changeStorageClass(key: string, newClass: StorageClass): Promise<void> {
    await this.client.send(new CopyObjectCommand({
      Bucket: this.bucket,
      Key: key,
      CopySource: `${this.bucket}/${encodeURIComponent(key)}`,
      StorageClass: newClass,
      MetadataDirective: 'COPY'
    }));
  }

  // Last-resort storage prices. Analytics prefers live AWS Price List API data.
  private static readonly FALLBACK_COST_PER_GB: Record<string, number> = {
    STANDARD: 0.023,
    INTELLIGENT_TIERING: 0.023,
    STANDARD_IA: 0.0125,
    ONEZONE_IA: 0.01,
    GLACIER_IR: 0.004,
    GLACIER: 0.0036,
    DEEP_ARCHIVE: 0.00099
  };

  private static fallbackPricing(error?: string): StoragePricingCatalog {
    const tiersByClass: Record<string, StoragePriceTier[]> = {};
    for (const [storageClass, pricePerGBMonth] of Object.entries(S3Service.FALLBACK_COST_PER_GB)) {
      tiersByClass[storageClass] = [{
        beginRange: 0,
        endRange: Number.POSITIVE_INFINITY,
        pricePerGBMonth,
        description: 'Static fallback S3 storage estimate'
      }];
    }
    return {
      source: 'static-fallback',
      asOf: new Date().toISOString(),
      tiersByClass,
      error
    };
  }

  private classifyStorageProduct(attrs: Record<string, string>, descriptions: string[]): StorageClass | null {
    const text = [
      attrs.storageClass,
      attrs.usagetype,
      attrs.operation,
      attrs.volumeType,
      ...descriptions
    ].join(' ').toLowerCase();

    if (text.includes('deep archive') || text.includes('timedstorage-gda')) return 'DEEP_ARCHIVE';
    if (text.includes('glacier instant') || text.includes('timedstorage-gir')) return 'GLACIER_IR';
    if (text.includes('glacier') || text.includes('timedstorage-glacier')) return 'GLACIER';
    if (text.includes('one zone') || text.includes('timedstorage-zia')) return 'ONEZONE_IA';
    if (text.includes('standard - infrequent') || text.includes('standard-infrequent') || text.includes('timedstorage-sia')) return 'STANDARD_IA';
    if (text.includes('intelligent-tiering') && (text.includes('frequent access') || text.includes('int-fa'))) return 'INTELLIGENT_TIERING';
    if (
      text.includes('general purpose')
      || text.includes('s3 standard storage')
      || text.includes('timedstorage-bytehrs')
    ) return 'STANDARD';
    return null;
  }

  private getPricingTiersFromProduct(rawProduct: string): { storageClass: StorageClass; tiers: StoragePriceTier[] } | null {
    const parsed = JSON.parse(rawProduct);
    const product = parsed.product;
    const attrs = product?.attributes ?? {};
    const onDemand = parsed.terms?.OnDemand ?? {};
    const dimensions = Object.values(onDemand)
      .flatMap((term: any) => Object.values(term.priceDimensions ?? {}) as any[]);

    const gbMonthDimensions = dimensions.filter((dim: any) =>
      String(dim.unit).toLowerCase() === 'gb-mo'
      && Number(dim.pricePerUnit?.USD) >= 0
      && !String(dim.description ?? '').toLowerCase().includes('metadata')
      && !String(dim.description ?? '').toLowerCase().includes('monitoring')
    );
    if (!gbMonthDimensions.length) return null;

    const storageClass = this.classifyStorageProduct(attrs, gbMonthDimensions.map((dim: any) => String(dim.description ?? '')));
    if (!storageClass) return null;

    const tiers = gbMonthDimensions
      .map((dim: any): StoragePriceTier => ({
        beginRange: Number(dim.beginRange ?? 0),
        endRange: dim.endRange === 'Inf' ? Number.POSITIVE_INFINITY : Number(dim.endRange ?? Number.POSITIVE_INFINITY),
        pricePerGBMonth: Number(dim.pricePerUnit.USD),
        description: String(dim.description ?? '')
      }))
      .filter(tier => Number.isFinite(tier.beginRange) && tier.pricePerGBMonth > 0)
      .sort((a, b) => a.beginRange - b.beginRange);

    return tiers.length ? { storageClass, tiers } : null;
  }

  private async getStoragePricing(): Promise<StoragePricingCatalog> {
    const cached = S3Service.pricingCache.get(this.region);
    if (cached && cached.expiresAt > Date.now()) return cached.catalog;

    try {
      const pricing = new PricingClient({
        region: 'us-east-1',
        credentials: this.credentials
      });
      const tiersByClass: Record<string, StoragePriceTier[]> = {};
      let nextToken: string | undefined;

      do {
        const res = await pricing.send(new GetProductsCommand({
          ServiceCode: 'AmazonS3',
          Filters: [
            { Type: 'TERM_MATCH', Field: 'regionCode', Value: this.region },
            { Type: 'TERM_MATCH', Field: 'productFamily', Value: 'Storage' }
          ],
          MaxResults: 100,
          NextToken: nextToken
        }));

        for (const priceListItem of res.PriceList ?? []) {
          const product = this.getPricingTiersFromProduct(String(priceListItem));
          if (!product) continue;
          const current = tiersByClass[product.storageClass] ?? [];
          tiersByClass[product.storageClass] = [...current, ...product.tiers]
            .sort((a, b) => a.beginRange - b.beginRange);
        }
        nextToken = res.NextToken;
      } while (nextToken);

      if (!Object.keys(tiersByClass).length) {
        throw new Error(`AWS Pricing API returned no S3 storage prices for ${this.region}.`);
      }

      const catalog: StoragePricingCatalog = {
        source: 'aws-pricing-api',
        asOf: new Date().toISOString(),
        tiersByClass
      };
      S3Service.pricingCache.set(this.region, {
        expiresAt: Date.now() + 12 * 60 * 60 * 1000,
        catalog
      });
      return catalog;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return S3Service.fallbackPricing(message);
    }
  }

  private monthlyStorageCost(bytes: number, tiers: StoragePriceTier[] | undefined): number {
    const gb = bytes / 1024 ** 3;
    const priceTiers = tiers?.length ? tiers : S3Service.fallbackPricing().tiersByClass.STANDARD;
    let total = 0;

    for (const tier of priceTiers) {
      const endRange = Number.isFinite(tier.endRange) ? tier.endRange : Number.POSITIVE_INFINITY;
      const billableGb = Math.max(0, Math.min(gb, endRange) - tier.beginRange);
      if (billableGb > 0) total += billableGb * tier.pricePerGBMonth;
      if (gb <= endRange) break;
    }

    return total;
  }

  async getAnalytics(): Promise<BucketAnalytics> {
    const CAP = 50_000;
    const tierMap = new Map<string, { count: number; bytes: number }>();
    const all: S3Object[] = [];
    let token: string | undefined;

    do {
      const res = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        ContinuationToken: token,
        MaxKeys: 1000
      }));

      for (const obj of res.Contents ?? []) {
        if (!obj.Key || obj.Key.endsWith('/')) continue; // skip folder marker objects
        const sc = obj.StorageClass ?? 'STANDARD';
        const size = obj.Size ?? 0;
        const entry = tierMap.get(sc) ?? { count: 0, bytes: 0 };
        entry.count++;
        entry.bytes += size;
        tierMap.set(sc, entry);
        all.push({
          key: obj.Key,
          size,
          lastModified: (obj.LastModified ?? new Date()).toISOString(),
          storageClass: sc,
          etag: obj.ETag
        });
      }

      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token && all.length < CAP);

    const pricing = await this.getStoragePricing();

    const byTier: TierStats[] = Array.from(tierMap.entries())
      .map(([sc, s]) => ({
        storageClass: sc,
        count: s.count,
        totalBytes: s.bytes,
        estimatedMonthlyCost: this.monthlyStorageCost(s.bytes, pricing.tiersByClass[sc]),
        pricePerGBMonth: pricing.tiersByClass[sc]?.[0]?.pricePerGBMonth
      }))
      .sort((a, b) => b.totalBytes - a.totalBytes);

    const totalBytes = all.reduce((n, o) => n + o.size, 0);
    const estimatedMonthlyCost = byTier.reduce((n, t) => n + t.estimatedMonthlyCost, 0);

    const largestFiles = [...all].sort((a, b) => b.size - a.size).slice(0, 10);
    const recentFiles  = [...all]
      .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())
      .slice(0, 10);

    return {
      totalObjects: all.length,
      totalBytes,
      estimatedMonthlyCost,
      byTier,
      largestFiles,
      recentFiles,
      scannedAt: new Date().toISOString(),
      capped: all.length >= CAP,
      region: this.region,
      pricingSource: pricing.source,
      pricingAsOf: pricing.asOf,
      pricingError: pricing.error
    };
  }

  /**
   * Verify that credentials, bucket name, and region are all correct.
   * Called before saving config so we surface problems immediately.
   */
  async testConnection(onLog?: (msg: string) => void): Promise<void> {
    const log = (msg: string) => { console.log(`[S3] ${msg}`); onLog?.(msg); };
    const logErr = (msg: string) => { console.error(`[S3] ${msg}`); onLog?.(`ERROR: ${msg}`); };

    log(`Connecting → bucket: "${this.bucket}"`);

    const timeoutMs = 15_000;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timed out after ${timeoutMs / 1000}s — check your internet connection and region.`)),
        timeoutMs
      )
    );

    try {
      const res = await Promise.race([
        this.client.send(new GetBucketLocationCommand({ Bucket: this.bucket })),
        timeout
      ]);
      log(`OK — bucket region confirmed: ${res.LocationConstraint ?? 'us-east-1'}`);
    } catch (err) {
      const friendly = S3Service.friendlyError(err, this.bucket);
      logErr(friendly);
      logErr(`Raw: ${err instanceof Error ? err.message : String(err)}`);
      throw new Error(friendly);
    }
  }

  private static friendlyError(err: unknown, bucket: string): string {
    const name: string = (err as any)?.name ?? '';
    const msg: string  = err instanceof Error ? err.message : String(err);

    if (name === 'InvalidAccessKeyId' || msg.includes('InvalidAccessKeyId'))
      return 'Invalid Access Key ID. Double-check AWS_ACCESS_KEY_ID in your .env file.';
    if (name === 'SignatureDoesNotMatch' || msg.includes('SignatureDoesNotMatch'))
      return 'Wrong secret key. Double-check AWS_SECRET_ACCESS_KEY in your .env file.';
    if (name === 'InvalidClientTokenId' || msg.includes('InvalidClientTokenId'))
      return 'Credentials are malformed or belong to an STS temporary token that has expired.';
    if (name === 'NoSuchBucket' || msg.includes('NoSuchBucket'))
      return `Bucket "${bucket}" does not exist. Verify the bucket name and that it was created in this region.`;
    if (name === 'AccessDenied' || msg.includes('AccessDenied'))
      return `Access denied to "${bucket}". Your IAM user lacks s3:GetBucketLocation permission, or the bucket policy blocks access.`;
    if (name === 'PermanentRedirect' || msg.includes('PermanentRedirect'))
      return `Wrong region. Bucket "${bucket}" is not in the configured region. Check AWS_REGION in your .env file.`;
    if (name === 'AuthorizationHeaderMalformed' || msg.includes('AuthorizationHeaderMalformed'))
      return `Region mismatch. The request was sent to the wrong regional endpoint. Verify AWS_REGION in your .env file.`;
    if (name === 'CredentialsProviderError' || msg.includes('Could not load credentials') || msg.includes('credential'))
      return 'No AWS credentials found. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in your .env file.';
    if (msg.includes('ENOTFOUND') || msg.includes('ETIMEDOUT') || msg.includes('ECONNREFUSED') || msg.includes('getaddrinfo'))
      return 'Cannot reach AWS S3. Check your internet connection.';
    return msg;
  }

  /**
   * Enable versioning on the bucket. Idempotent — safe to call repeatedly.
   * Required for the version history / restore feature to do anything useful.
   */
  async ensureVersioningEnabled(): Promise<void> {
    await this.client.send(new PutBucketVersioningCommand({
      Bucket: this.bucket,
      VersioningConfiguration: { Status: 'Enabled' }
    }));
  }

  async createFolder(prefix: string): Promise<void> {
    const key = prefix.endsWith('/') ? prefix : prefix + '/';
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: ''
    }));
  }

  /** Move an object by copying to the new key then deleting the source. */
  async move(sourceKey: string, destKey: string): Promise<void> {
    await this.client.send(new CopyObjectCommand({
      Bucket: this.bucket,
      Key: destKey,
      CopySource: `${this.bucket}/${encodeURIComponent(sourceKey)}`,
      MetadataDirective: 'COPY'
    }));
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: sourceKey
    }));
  }
}
