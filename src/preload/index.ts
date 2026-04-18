import { contextBridge, ipcRenderer } from 'electron';
console.log('[Preload] starting — contextBridge available:', typeof contextBridge);
import type {
  AppConfig,
  BucketAnalytics,
  RestoreRequest,
  Result,
  S3Object,
  S3ObjectVersion,
  StorageClass,
  UploadProgress
} from '../shared/types';

// Everything the renderer can call. No `nodeIntegration: true` shortcuts —
// the renderer stays sandboxed and can only do what we explicitly expose.
const api = {
  config: {
    get: (): Promise<Result<AppConfig | null>> => ipcRenderer.invoke('config:get'),
    set: (cfg: AppConfig): Promise<Result<AppConfig>> => ipcRenderer.invoke('config:set', cfg),
    onConnectLog: (cb: (msg: string) => void): (() => void) => {
      const listener = (_e: unknown, msg: string) => cb(msg);
      ipcRenderer.on('s3:connectLog', listener);
      return () => ipcRenderer.removeListener('s3:connectLog', listener);
    }
  },
  s3: {
    list: (prefix: string): Promise<Result<{ folders: string[]; files: S3Object[] }>> =>
      ipcRenderer.invoke('s3:list', prefix),
    search: (query: string): Promise<Result<S3Object[]>> =>
      ipcRenderer.invoke('s3:search', query),
    upload: (args: { localPath: string; key: string; storageClass: StorageClass }): Promise<Result<true>> =>
      ipcRenderer.invoke('s3:upload', args),
    download: (args: { key: string; versionId?: string }): Promise<Result<string | null>> =>
      ipcRenderer.invoke('s3:download', args),
    previewExternal: (key: string): Promise<Result<string>> =>
      ipcRenderer.invoke('s3:previewExternal', key),
    presign: (args: { key: string; expiresInSeconds: number }): Promise<Result<string>> =>
      ipcRenderer.invoke('s3:presign', args),
    delete: (args: { key: string; versionId?: string }): Promise<Result<true>> =>
      ipcRenderer.invoke('s3:delete', args),
    listVersions: (key: string): Promise<Result<S3ObjectVersion[]>> =>
      ipcRenderer.invoke('s3:listVersions', key),
    restoreVersion: (args: { key: string; versionId: string }): Promise<Result<true>> =>
      ipcRenderer.invoke('s3:restoreVersion', args),
    enableVersioning: (): Promise<Result<true>> => ipcRenderer.invoke('s3:enableVersioning'),
    initiateGlacierRestore: (req: RestoreRequest): Promise<Result<true>> =>
      ipcRenderer.invoke('s3:initiateGlacierRestore', req),
    checkRestoreStatus: (args: { key: string; versionId?: string }): Promise<Result<{
      ongoing: boolean; expiry?: string; storageClass?: string;
    }>> => ipcRenderer.invoke('s3:checkRestoreStatus', args),
    changeStorageClass: (args: { key: string; storageClass: StorageClass }): Promise<Result<true>> =>
      ipcRenderer.invoke('s3:changeStorageClass', args),
    analytics: (): Promise<Result<BucketAnalytics>> =>
      ipcRenderer.invoke('s3:analytics'),
    createFolder: (key: string): Promise<Result<true>> =>
      ipcRenderer.invoke('s3:createFolder', key),
    onUploadProgress: (cb: (p: UploadProgress) => void): (() => void) => {
      const listener = (_e: unknown, p: UploadProgress) => cb(p);
      ipcRenderer.on('s3:uploadProgress', listener);
      return () => ipcRenderer.removeListener('s3:uploadProgress', listener);
    }
  },
  dialog: {
    pickFiles: (): Promise<Result<string[]>> => ipcRenderer.invoke('dialog:pickFiles')
  },
  shell: {
    openExternal: (url: string): Promise<Result<true>> =>
      ipcRenderer.invoke('shell:openExternal', url)
  }
};

try {
  contextBridge.exposeInMainWorld('s3drive', api);
  console.log('[Preload] s3drive exposed successfully');
} catch (e) {
  console.error('[Preload] exposeInMainWorld FAILED:', e);
}

export type S3DriveAPI = typeof api;
