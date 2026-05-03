import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import * as nodeHttps from 'node:https';
import { S3Service } from './s3Service';
import { ConfigStore, toPublicAppConfig } from './configStore';
import { GoogleDriveService } from './googleDriveService';
import { canUseSecureStorage, readJsonFile, writeSecureJsonFile } from './secureStore';
import type {
  AppConfig,
  BucketAnalytics,
  GDriveConfig,
  GDriveFile,
  PickedFolderFile,
  PickedUploadFile,
  PublicAppConfig,
  PublicMultiConfig,
  RestoreRequest,
  Result,
  S3Object,
  S3ObjectVersion,
  StorageClass,
  UploadRequest,
  UploadProgress
} from '@shared/types';

let mainWindow: BrowserWindow | null = null;
let s3: S3Service | null = null;
const configStore = new ConfigStore();
let gdrive: GoogleDriveService | null = null;
const pendingUploads = new Map<string, { localPath: string; selectedAt: number }>();
const UPLOAD_TOKEN_TTL_MS = 30 * 60 * 1000;

function gdriveConfigPath() { return join(app.getPath('userData'), 'gdrive-config.json'); }

function prunePendingUploads(): void {
  const cutoff = Date.now() - UPLOAD_TOKEN_TTL_MS;
  for (const [id, entry] of pendingUploads) {
    if (entry.selectedAt < cutoff) pendingUploads.delete(id);
  }
}

function registerUploadFile(localPath: string, displayName?: string): PickedUploadFile {
  prunePendingUploads();
  const id = randomUUID();
  pendingUploads.set(id, { localPath, selectedAt: Date.now() });
  return { id, name: (displayName || basename(localPath) || 'file').replace(/\\/g, '/') };
}

function consumeUploadPath(uploadId: string): string {
  prunePendingUploads();
  const entry = pendingUploads.get(uploadId);
  if (!entry) throw new Error('Upload selection expired. Pick the file again.');
  pendingUploads.delete(uploadId);
  return entry.localPath;
}

function collectFolderUploadFiles(folderPath: string): { folderName: string; files: PickedFolderFile[] } {
  const folderName = basename(folderPath) || 'folder';
  const files: PickedFolderFile[] = [];

  function walk(dir: string, base: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = (base ? `${base}/${entry}` : entry).replace(/\\/g, '/');
      const st = lstatSync(full);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        walk(full, rel);
      } else if (st.isFile()) {
        files.push({ ...registerUploadFile(full), relativePath: rel });
      }
    }
  }

  walk(folderPath, '');
  return { folderName, files };
}

function requireObjectKey(key: string): string {
  const normalized = String(key ?? '').replace(/\\/g, '/');
  if (!normalized || normalized.endsWith('/')) throw new Error('A file name is required.');
  return normalized;
}

function safeTempName(key: string): string {
  const raw = key.replace(/\\/g, '/').split('/').pop() || 'preview';
  const cleaned = raw.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/^\.+$/, '_');
  return cleaned || 'preview';
}

function requireHttpsUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid external URL.');
  }
  if (parsed.protocol !== 'https:') throw new Error('Only HTTPS URLs can be opened externally.');
  return parsed.toString();
}

async function openSafeExternal(url: string): Promise<void> {
  await shell.openExternal(requireHttpsUrl(url));
}

function isAllowedAppNavigation(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (process.env.NODE_ENV === 'development') {
      return parsed.origin === 'http://localhost:5173' || parsed.origin === 'http://127.0.0.1:5173';
    }
    return parsed.protocol === 'file:';
  } catch {
    return false;
  }
}

function loadGDriveService(): GoogleDriveService | null {
  const p = gdriveConfigPath();
  if (!existsSync(p)) return null;
  try {
    const cfg = readJsonFile<GDriveConfig>(p);
    if (!cfg?.clientId || !cfg.clientSecret) return null;
    if (canUseSecureStorage()) writeSecureJsonFile(p, cfg);
    return new GoogleDriveService(cfg, app.getPath('userData'));
  } catch { return null; }
}

// Wrap any handler so a thrown error becomes a Result<never> instead
// of crashing the IPC bridge. The renderer shows the error in the UI.
function safe<T>(fn: () => Promise<T>): Promise<Result<T>> {
  return fn()
    .then((value) => ({ ok: true as const, value }))
    .catch((err: unknown) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err)
    }));
}

function requireS3(): S3Service {
  if (!s3) throw new Error('S3 not configured. Open settings and set your bucket and region.');
  return s3;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0e0e10',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openSafeExternal(url).catch((err) => console.error('[Shell] Blocked external URL:', err));
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedAppNavigation(url)) return;
    event.preventDefault();
    openSafeExternal(url).catch((err) => console.error('[Shell] Blocked navigation URL:', err));
  });
}

app.whenReady().then(() => {
  // Boot: if there's a saved config, instantiate the S3 service immediately.
  const cfg = configStore.get();
  if (cfg?.bucket && cfg?.region) {
    s3 = new S3Service(cfg);
  }
  gdrive = loadGDriveService();

  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function registerIpcHandlers() {
  // ===== Config =====
  ipcMain.handle('config:get', async (): Promise<Result<PublicAppConfig | null>> => safe(async () => {
    const stored = configStore.get();
    if (stored?.bucket && stored?.region) {
      console.log(`[Config] Loaded saved config — bucket: "${stored.bucket}", region: "${stored.region}"`);
      return toPublicAppConfig(stored);
    }
    console.log('[Config] No saved config found — waiting for user to configure via Settings');
    return null;
  }));

  ipcMain.handle('config:set', async (_e, cfg: AppConfig): Promise<Result<PublicAppConfig>> => safe(async () => {
    const push = (msg: string) => mainWindow?.webContents.send('s3:connectLog', msg);
    push(`bucket: "${cfg.bucket}"  region: "${cfg.region}"  profile: "${cfg.profile ?? 'default'}"`);
    const service = new S3Service(cfg);
    await service.testConnection(push);
    configStore.set(cfg);
    s3 = service;
    pendingUploads.clear();
    push('Config saved.');
    return toPublicAppConfig(cfg);
  }));

  ipcMain.handle('config:getAll', async (): Promise<Result<PublicMultiConfig | null>> =>
    safe(async () => configStore.getAllPublic())
  );

  ipcMain.handle('config:setActive', async (_e, index: number): Promise<Result<PublicAppConfig | null>> =>
    safe(async () => {
      const cfg = configStore.setActive(index);
      if (!cfg) throw new Error('Invalid bucket index');
      s3 = new S3Service(cfg);
      pendingUploads.clear();
      return toPublicAppConfig(cfg);
    })
  );

  ipcMain.handle('config:remove', async (_e, index: number): Promise<Result<true>> =>
    safe(async () => {
      configStore.remove(index);
      const active = configStore.get();
      s3 = active ? new S3Service(active) : null;
      pendingUploads.clear();
      return true as const;
    })
  );

  // ===== Browse =====
  ipcMain.handle('s3:list', async (_e, prefix: string) =>
    safe(async () => requireS3().list(prefix))
  );

  ipcMain.handle('s3:search', async (_e, query: string) =>
    safe(async () => requireS3().search(query))
  );

  // ===== Upload =====
  ipcMain.handle('dialog:pickFiles', async (): Promise<Result<PickedUploadFile[]>> => safe(async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections']
    });
    return res.canceled ? [] : res.filePaths.map(path => registerUploadFile(path));
  }));

  ipcMain.handle('dialog:pickFolder', async (): Promise<Result<{
    folderName: string;
    files: PickedFolderFile[];
  } | null>> => safe(async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory']
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return collectFolderUploadFiles(res.filePaths[0]);
  }));

  ipcMain.handle('dialog:registerDroppedFiles', async (
    _e,
    paths: string[]
  ): Promise<Result<PickedUploadFile[]>> => safe(async () => {
    if (!Array.isArray(paths)) return [];
    const picked: PickedUploadFile[] = [];
    const seen = new Set<string>();

    for (const rawPath of paths) {
      if (typeof rawPath !== 'string') continue;
      const localPath = rawPath.trim();
      if (!localPath || seen.has(localPath)) continue;
      seen.add(localPath);

      const st = lstatSync(localPath);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        const folder = collectFolderUploadFiles(localPath);
        picked.push(...folder.files.map(file => ({
          id: file.id,
          name: `${folder.folderName}/${file.relativePath}`
        })));
      } else if (st.isFile()) {
        picked.push(registerUploadFile(localPath));
      }
    }

    return picked;
  }));

  ipcMain.handle('s3:upload', async (
    _e,
    args: UploadRequest
  ) => safe(async () => {
    const service = requireS3();
    const localPath = consumeUploadPath(args.uploadId);
    await service.upload({
      localPath,
      key: requireObjectKey(args.key),
      storageClass: args.storageClass
    }, (p: UploadProgress) => {
      // Stream progress back to the renderer via a dedicated channel.
      mainWindow?.webContents.send('s3:uploadProgress', p);
    });
    return true;
  }));

  // ===== Download =====
  ipcMain.handle('s3:download', async (
    _e,
    args: { key: string; versionId?: string }
  ) => safe(async () => {
    const res = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: args.key.split('/').pop() ?? 'download'
    });
    if (res.canceled || !res.filePath) return null;
    await requireS3().download(args.key, res.filePath, args.versionId, (p) => {
      mainWindow?.webContents.send('s3:downloadProgress', p);
    });
    return res.filePath;
  }));

  // ===== Cancel upload =====
  ipcMain.handle('s3:cancelUpload', async (_e, key: string) => safe(async () => {
    requireS3().cancelUpload(key);
    return true as const;
  }));

  // ===== Preview =====
  // Download to temp, then let the OS open it with the default app.
  // For images and PDFs the renderer will instead call s3:presign and embed.
  ipcMain.handle('s3:previewExternal', async (_e, key: string) => safe(async () => {
    const tmpPath = join(tmpdir(), `s3drive-${Date.now()}-${safeTempName(key)}`);
    await requireS3().download(key, tmpPath);
    await shell.openPath(tmpPath);
    return tmpPath;
  }));

  // ===== Sharing =====
  ipcMain.handle('s3:presign', async (
    _e,
    args: { key: string; expiresInSeconds: number }
  ) => safe(async () => requireS3().presign(args.key, args.expiresInSeconds)));

  // ===== Delete =====
  ipcMain.handle('s3:delete', async (
    _e,
    args: { key: string; versionId?: string }
  ) => safe(async () => {
    await requireS3().delete(args.key, args.versionId);
    return true;
  }));

  // ===== Versioning =====
  ipcMain.handle('s3:listVersions', async (_e, key: string): Promise<Result<S3ObjectVersion[]>> =>
    safe(async () => requireS3().listVersions(key))
  );

  ipcMain.handle('s3:restoreVersion', async (
    _e,
    args: { key: string; versionId: string }
  ) => safe(async () => {
    await requireS3().restoreVersion(args.key, args.versionId);
    return true;
  }));

  ipcMain.handle('s3:enableVersioning', async () => safe(async () => {
    await requireS3().ensureVersioningEnabled();
    return true;
  }));

  // ===== Glacier restore =====
  ipcMain.handle('s3:initiateGlacierRestore', async (_e, req: RestoreRequest) =>
    safe(async () => {
      await requireS3().initiateGlacierRestore(req);
      return true;
    })
  );

  ipcMain.handle('s3:checkRestoreStatus', async (
    _e,
    args: { key: string; versionId?: string }
  ) => safe(async () => requireS3().checkRestoreStatus(args.key, args.versionId)));

  // ===== Storage class change =====
  ipcMain.handle('s3:changeStorageClass', async (
    _e,
    args: { key: string; storageClass: StorageClass }
  ) => safe(async () => {
    await requireS3().changeStorageClass(args.key, args.storageClass);
    return true;
  }));

  // ===== Create folder =====
  ipcMain.handle('s3:createFolder', async (_e, key: string) =>
    safe(async () => { await requireS3().createFolder(key); return true; })
  );

  // ===== Move (copy + delete) =====
  ipcMain.handle('s3:move', async (_e, args: { sourceKey: string; destKey: string }) =>
    safe(async () => { await requireS3().move(args.sourceKey, args.destKey); return true as const; })
  );

  // ===== Analytics =====
  ipcMain.handle('s3:analytics', async (): Promise<Result<BucketAnalytics>> =>
    safe(async () => requireS3().getAnalytics())
  );

  // ===== Open external (for share links) =====
  ipcMain.handle('shell:openExternal', async (_e, url: string) => safe(async () => {
    await openSafeExternal(url);
    return true;
  }));

  ipcMain.handle('shell:fetchAWSStatus', async () => safe(async () =>
    new Promise<string>((resolve, reject) => {
      const req = nodeHttps.get('https://status.aws.amazon.com/data.json', (res) => {
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    })
  ));

  // ===== Folder operations =====
  ipcMain.handle('s3:deleteFolder', async (_e, prefix: string) =>
    safe(async () => {
      const count = await requireS3().deleteFolder(prefix);
      return count;
    })
  );

  ipcMain.handle('s3:downloadFoldersAsZip', async (
    _e,
    args: { prefixes: string[]; zipName: string; jobKey: string }
  ) => safe(async () => {
    const folderName = args.prefixes.length === 1
      ? args.prefixes[0].replace(/\/$/, '').split('/').pop() ?? 'folder'
      : 'folders';
    const res = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: args.zipName || `${folderName}.zip`,
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
    });
    if (res.canceled || !res.filePath) return null;
    await requireS3().downloadFoldersAsZip(args.prefixes, res.filePath, (p) => {
      mainWindow?.webContents.send('s3:downloadProgress', p);
    }, args.jobKey);
    return res.filePath;
  }));

  // ===== Google Drive =====
  ipcMain.handle('gdrive:init', async (_e, cfg: GDriveConfig): Promise<Result<true>> =>
    safe(async () => {
      writeSecureJsonFile(gdriveConfigPath(), cfg);
      gdrive = new GoogleDriveService(cfg, app.getPath('userData'));
      return true as const;
    })
  );

  ipcMain.handle('gdrive:status', async (): Promise<Result<{ connected: boolean }>> =>
    safe(async () => ({ connected: !!gdrive?.isConnected() }))
  );

  ipcMain.handle('gdrive:auth', async (): Promise<Result<true>> =>
    safe(async () => {
      if (!gdrive) throw new Error('Google Drive not configured.');
      await gdrive.authenticate(openSafeExternal);
      return true as const;
    })
  );

  ipcMain.handle('gdrive:list', async (_e, folderId?: string): Promise<Result<GDriveFile[]>> =>
    safe(async () => {
      if (!gdrive?.isConnected()) throw new Error('Not connected to Google Drive.');
      return gdrive.listFiles(folderId);
    })
  );

  ipcMain.handle('gdrive:transfer', async (
    _e,
    args: { files: GDriveFile[]; destPrefix: string; storageClass: StorageClass }
  ): Promise<Result<true>> =>
    safe(async () => {
      if (!gdrive?.isConnected()) throw new Error('Not connected to Google Drive.');
      const service = requireS3();
      for (const file of args.files) {
        const key = `${args.destPrefix}${file.name}`;
        const { stream, size } = await gdrive.getFileStream(file);
        await service.uploadStream(key, stream, size, args.storageClass, (p) => {
          mainWindow?.webContents.send('s3:uploadProgress', p);
        });
      }
      return true as const;
    })
  );

  ipcMain.handle('gdrive:disconnect', async (): Promise<Result<true>> =>
    safe(async () => {
      gdrive?.disconnect();
      gdrive = null;
      return true as const;
    })
  );
}

// TypeScript needs this re-export to satisfy bundlers in some configs.
export type { S3Object };
