import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { S3Service } from './s3Service';
import { ConfigStore } from './configStore';
import type {
  AppConfig,
  BucketAnalytics,
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
}

// TypeScript needs this re-export to satisfy bundlers in some configs.
export type { S3Object };
