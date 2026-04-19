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
import archiver from 'archiver';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, createWriteStream, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import { fromEnv, fromIni } from '@aws-sdk/credential-providers';
import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';
import {
  AppConfig,
  BucketAnalytics,
  FolderInfo,
  RestoreRequest,
  S3Object,
  S3ObjectVersion,
  StorageClass,
  TierStats,
  UploadProgress,
  UploadRequest
} from '@shared/types';

// Load .env from the project root (works in both dev and packaged app)
loadEnv({ path: join(__dirname, '../../.env') });

// Threshold above which we switch to multipart upload (5 MB chunks).
// AWS allows multipart down to 5 MB parts; below that single PutObject is fine.
const MULTIPART_THRESHOLD = 5 * 1024 * 1024;
const PART_SIZE = 5 * 1024 * 1024;

export class S3Service {
  private client: S3Client;
  private bucket: string;
  private region: string;
  private activeUploads = new Map<string, Upload>();

  constructor(config: AppConfig) {
    this.bucket = config.bucket;
    this.region = config.region;
    // Use explicit providers so the SDK never falls through to EC2 IMDS,
    // which hangs indefinitely on non-EC2 machines.
    const credentials = config.profile
      ? fromIni({ profile: config.profile })
      : (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
        ? fromEnv()
        : fromIni(); // reads ~/.aws/credentials default profile only
    this.client = new S3Client({ region: config.region, credentials });
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

  /**
   * Upload with progress callbacks. Uses multipart for files >= 5 MB.
   * The user-chosen storage class is set at upload time — this is the cheap path.
   * Changing storage class later requires a CopyObject (we expose that separately).
   */
  async upload(
    req: UploadRequest,
    onProgress: (p: UploadProgress) => void
  ): Promise<void> {
    const stat = statSync(req.localPath);
    const stream = createReadStream(req.localPath);

    const uploader = new Upload({
      client: this.client,
      partSize: PART_SIZE,
      queueSize: stat.size >= MULTIPART_THRESHOLD ? 4 : 1,
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
      partSize: PART_SIZE,
      queueSize: size >= MULTIPART_THRESHOLD ? 4 : 1,
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
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket, Prefix: prefix, ContinuationToken: token
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

  /** Stream all objects under the given prefixes into a single zip file. */
  async downloadFoldersAsZip(
    prefixes: string[],
    destPath: string,
    onProgress: (p: UploadProgress) => void,
    jobKey: string
  ): Promise<void> {
    // List all objects across all prefixes
    const objects: { key: string; size: number }[] = [];
    for (const prefix of prefixes) {
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
    const commonPrefix = prefixes.length === 1 ? prefixes[0] : '';

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

  // Storage cost per GB/month in USD by region (AWS list prices, storage only).
  private static readonly REGION_COST_PER_GB: Record<string, Record<string, number>> = {
    'us-east-1':    { STANDARD: 0.023,  INTELLIGENT_TIERING: 0.023,  STANDARD_IA: 0.0125, ONEZONE_IA: 0.01,  GLACIER_IR: 0.004,  GLACIER: 0.0036, DEEP_ARCHIVE: 0.00099 },
    'us-east-2':    { STANDARD: 0.023,  INTELLIGENT_TIERING: 0.023,  STANDARD_IA: 0.0125, ONEZONE_IA: 0.01,  GLACIER_IR: 0.004,  GLACIER: 0.0036, DEEP_ARCHIVE: 0.00099 },
    'us-west-1':    { STANDARD: 0.026,  INTELLIGENT_TIERING: 0.026,  STANDARD_IA: 0.0138, ONEZONE_IA: 0.011, GLACIER_IR: 0.0045, GLACIER: 0.004,  DEEP_ARCHIVE: 0.0011  },
    'us-west-2':    { STANDARD: 0.023,  INTELLIGENT_TIERING: 0.023,  STANDARD_IA: 0.0125, ONEZONE_IA: 0.01,  GLACIER_IR: 0.004,  GLACIER: 0.0036, DEEP_ARCHIVE: 0.00099 },
    'eu-west-1':    { STANDARD: 0.023,  INTELLIGENT_TIERING: 0.023,  STANDARD_IA: 0.0125, ONEZONE_IA: 0.01,  GLACIER_IR: 0.004,  GLACIER: 0.0036, DEEP_ARCHIVE: 0.00099 },
    'eu-west-2':    { STANDARD: 0.024,  INTELLIGENT_TIERING: 0.024,  STANDARD_IA: 0.013,  ONEZONE_IA: 0.0104,GLACIER_IR: 0.0042, GLACIER: 0.0038, DEEP_ARCHIVE: 0.0011  },
    'eu-central-1': { STANDARD: 0.0245, INTELLIGENT_TIERING: 0.0245, STANDARD_IA: 0.013,  ONEZONE_IA: 0.01,  GLACIER_IR: 0.0044, GLACIER: 0.0039, DEEP_ARCHIVE: 0.00099 },
    'ap-south-1':   { STANDARD: 0.025,  INTELLIGENT_TIERING: 0.025,  STANDARD_IA: 0.0138, ONEZONE_IA: 0.011, GLACIER_IR: 0.0045, GLACIER: 0.004,  DEEP_ARCHIVE: 0.0011  },
    'ap-south-2':   { STANDARD: 0.025,  INTELLIGENT_TIERING: 0.025,  STANDARD_IA: 0.0138, ONEZONE_IA: 0.011, GLACIER_IR: 0.0045, GLACIER: 0.004,  DEEP_ARCHIVE: 0.0011  },
    'ap-southeast-1':{ STANDARD: 0.025, INTELLIGENT_TIERING: 0.025,  STANDARD_IA: 0.0138, ONEZONE_IA: 0.011, GLACIER_IR: 0.0045, GLACIER: 0.004,  DEEP_ARCHIVE: 0.0011  },
    'ap-southeast-2':{ STANDARD: 0.025, INTELLIGENT_TIERING: 0.025,  STANDARD_IA: 0.0138, ONEZONE_IA: 0.011, GLACIER_IR: 0.0045, GLACIER: 0.004,  DEEP_ARCHIVE: 0.0011  },
    'ap-northeast-1':{ STANDARD: 0.025, INTELLIGENT_TIERING: 0.025,  STANDARD_IA: 0.0138, ONEZONE_IA: 0.011, GLACIER_IR: 0.0045, GLACIER: 0.004,  DEEP_ARCHIVE: 0.0011  },
    'ap-northeast-2':{ STANDARD: 0.025, INTELLIGENT_TIERING: 0.025,  STANDARD_IA: 0.0138, ONEZONE_IA: 0.011, GLACIER_IR: 0.0045, GLACIER: 0.004,  DEEP_ARCHIVE: 0.0011  },
    'ca-central-1': { STANDARD: 0.024,  INTELLIGENT_TIERING: 0.024,  STANDARD_IA: 0.013,  ONEZONE_IA: 0.0104,GLACIER_IR: 0.0042, GLACIER: 0.0038, DEEP_ARCHIVE: 0.00099 },
    'sa-east-1':    { STANDARD: 0.0405, INTELLIGENT_TIERING: 0.0405, STANDARD_IA: 0.0225, ONEZONE_IA: 0.018, GLACIER_IR: 0.0073, GLACIER: 0.0066, DEEP_ARCHIVE: 0.0018  },
    'me-south-1':   { STANDARD: 0.0252, INTELLIGENT_TIERING: 0.0252, STANDARD_IA: 0.014,  ONEZONE_IA: 0.011, GLACIER_IR: 0.0046, GLACIER: 0.004,  DEEP_ARCHIVE: 0.0011  },
    'af-south-1':   { STANDARD: 0.0275, INTELLIGENT_TIERING: 0.0275, STANDARD_IA: 0.0152, ONEZONE_IA: 0.012, GLACIER_IR: 0.005,  GLACIER: 0.0045, DEEP_ARCHIVE: 0.0012  },
  };

  private costPerGB(sc: string): number {
    const table = S3Service.REGION_COST_PER_GB[this.region]
      ?? S3Service.REGION_COST_PER_GB['us-east-1'];
    return table[sc] ?? 0.023;
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

    const byTier: TierStats[] = Array.from(tierMap.entries())
      .map(([sc, s]) => ({
        storageClass: sc,
        count: s.count,
        totalBytes: s.bytes,
        estimatedMonthlyCost: (s.bytes / 1024 ** 3) * this.costPerGB(sc)
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
      region: this.region
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
