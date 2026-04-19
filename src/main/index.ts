import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import * as nodeHttps from 'node:https';
import { S3Service } from './s3Service';
import { ConfigStore } from './configStore';
import { GoogleDriveService } from './googleDriveService';
import type {
  AppConfig,
  BucketAnalytics,
  GDriveConfig,
  GDriveFile,
  MultiConfig,
  RestoreRequest,
  Result,
  S3Object,
  S3ObjectVersion,
  StorageClass,
  UploadProgress
} from '@shared/types';

let mainWindow: BrowserWindow | null = null;
let s3: S3Service | null = null;
const configStore = new ConfigStore();
let gdrive: GoogleDriveService | null = null;

function gdriveConfigPath() { return join(app.getPath('userData'), 'gdrive-config.json'); }

function loadGDriveService(): GoogleDriveService | null {
  const p = gdriveConfigPath();
  if (!existsSync(p)) return null;
  try {
    const cfg: GDriveConfig = JSON.parse(readFileSync(p, 'utf-8'));
    if (!cfg.clientId || !cfg.clientSecret) return null;
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
      nodeIntegration: false
    }
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
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
  ipcMain.handle('config:get', async () => safe(async () => {
    const stored = configStore.get();
    if (stored?.bucket && stored?.region) {
      console.log(`[Config] Loaded saved config — bucket: "${stored.bucket}", region: "${stored.region}"`);
      return stored;
    }
    console.log('[Config] No saved config found — waiting for user to configure via Settings');
    return null;
  }));

  ipcMain.handle('config:set', async (_e, cfg: AppConfig) => safe(async () => {
    const push = (msg: string) => mainWindow?.webContents.send('s3:connectLog', msg);
    push(`bucket: "${cfg.bucket}"  region: "${cfg.region}"  profile: "${cfg.profile ?? 'default'}"`);
    const service = new S3Service(cfg);
    await service.testConnection(push);
    configStore.set(cfg);
    s3 = service;
    push('Config saved.');
    return cfg;
  }));

  ipcMain.handle('config:getAll', async (): Promise<Result<MultiConfig | null>> =>
    safe(async () => configStore.getAll())
  );

  ipcMain.handle('config:setActive', async (_e, index: number): Promise<Result<AppConfig | null>> =>
    safe(async () => {
      const cfg = configStore.setActive(index);
      if (!cfg) throw new Error('Invalid bucket index');
      s3 = new S3Service(cfg);
      return cfg;
    })
  );

  ipcMain.handle('config:remove', async (_e, index: number): Promise<Result<true>> =>
    safe(async () => {
      configStore.remove(index);
      const active = configStore.get();
      if (active) s3 = new S3Service(active);
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
  ipcMain.handle('dialog:pickFiles', async () => safe(async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections']
    });
    return res.canceled ? [] : res.filePaths;
  }));

  ipcMain.handle('dialog:pickFolder', async () => safe(async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory']
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const folderPath = res.filePaths[0];
    const folderName = folderPath.replace(/\\/g, '/').split('/').pop() ?? 'folder';
    const files: { localPath: string; relativePath: string }[] = [];
    function walk(dir: string, base: string) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const rel = base ? `${base}/${entry}` : entry;
        if (statSync(full).isDirectory()) {
          walk(full, rel);
        } else {
          files.push({ localPath: full, relativePath: rel });
        }
      }
    }
    walk(folderPath, '');
    return { folderName, files };
  }));

  ipcMain.handle('s3:upload', async (
    _e,
    args: { localPath: string; key: string; storageClass: StorageClass }
  ) => safe(async () => {
    const service = requireS3();
    await service.upload(args, (p: UploadProgress) => {
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
    const tmpPath = join(tmpdir(), `s3drive-${Date.now()}-${key.split('/').pop() ?? 'preview'}`);
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
    await shell.openExternal(url);
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
      writeFileSync(gdriveConfigPath(), JSON.stringify(cfg), 'utf-8');
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
      await gdrive.authenticate((url) => shell.openExternal(url));
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
