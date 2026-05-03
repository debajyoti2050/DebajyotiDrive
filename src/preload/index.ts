import { contextBridge, ipcRenderer, webUtils } from 'electron';
console.log('[Preload] starting — contextBridge available:', typeof contextBridge);
import type {
  AppConfig,
  BucketAnalytics,
  FolderInfo,
  GDriveConfig,
  GDriveFile,
  PhotoLibraryResult,
  PickedPhotoUploadFile,
  PickedFolderFile,
  PickedUploadFile,
  PublicAppConfig,
  PublicMultiConfig,
  RestoreRequest,
  Result,
  S3Object,
  S3ObjectVersion,
  StorageClass,
  UpdateInfo,
  UploadRequest,
  UploadProgress
} from '../shared/types';

// Everything the renderer can call. No `nodeIntegration: true` shortcuts —
// the renderer stays sandboxed and can only do what we explicitly expose.
const api = {
  config: {
    get: (): Promise<Result<PublicAppConfig | null>> => ipcRenderer.invoke('config:get'),
    getAll: (): Promise<Result<PublicMultiConfig | null>> => ipcRenderer.invoke('config:getAll'),
    set: (cfg: AppConfig): Promise<Result<PublicAppConfig>> => ipcRenderer.invoke('config:set', cfg),
    setActive: (index: number): Promise<Result<PublicAppConfig | null>> => ipcRenderer.invoke('config:setActive', index),
    remove: (index: number): Promise<Result<true>> => ipcRenderer.invoke('config:remove', index),
    onConnectLog: (cb: (msg: string) => void): (() => void) => {
      const listener = (_e: unknown, msg: string) => cb(msg);
      ipcRenderer.on('s3:connectLog', listener);
      return () => ipcRenderer.removeListener('s3:connectLog', listener);
    }
  },
  s3: {
    list: (prefix: string): Promise<Result<{ folders: FolderInfo[]; files: S3Object[] }>> =>
      ipcRenderer.invoke('s3:list', prefix),
    search: (query: string): Promise<Result<S3Object[]>> =>
      ipcRenderer.invoke('s3:search', query),
    upload: (args: UploadRequest): Promise<Result<true>> =>
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
    move: (args: { sourceKey: string; destKey: string }): Promise<Result<true>> =>
      ipcRenderer.invoke('s3:move', args),
    cancelUpload: (key: string): Promise<Result<true>> =>
      ipcRenderer.invoke('s3:cancelUpload', key),
    deleteFolder: (prefix: string): Promise<Result<number>> =>
      ipcRenderer.invoke('s3:deleteFolder', prefix),
    downloadFoldersAsZip: (args: { prefixes: string[]; zipName: string; jobKey: string }): Promise<Result<string | null>> =>
      ipcRenderer.invoke('s3:downloadFoldersAsZip', args),
    onUploadProgress: (cb: (p: UploadProgress) => void): (() => void) => {
      const listener = (_e: unknown, p: UploadProgress) => cb(p);
      ipcRenderer.on('s3:uploadProgress', listener);
      return () => ipcRenderer.removeListener('s3:uploadProgress', listener);
    },
    onDownloadProgress: (cb: (p: UploadProgress) => void): (() => void) => {
      const listener = (_e: unknown, p: UploadProgress) => cb(p);
      ipcRenderer.on('s3:downloadProgress', listener);
      return () => ipcRenderer.removeListener('s3:downloadProgress', listener);
    }
  },
  dialog: {
    pickFiles: (): Promise<Result<PickedUploadFile[]>> => ipcRenderer.invoke('dialog:pickFiles'),
    pickFolder: (): Promise<Result<{ folderName: string; files: PickedFolderFile[] } | null>> =>
      ipcRenderer.invoke('dialog:pickFolder'),
    registerDroppedFiles: (files: File[]): Promise<Result<PickedUploadFile[]>> => {
      const paths = Array.from(files)
        .map(file => {
          try { return webUtils.getPathForFile(file); }
          catch { return ''; }
        })
        .filter((path): path is string => Boolean(path));
      return ipcRenderer.invoke('dialog:registerDroppedFiles', paths);
    },
  },
  photos: {
    list: (): Promise<Result<PhotoLibraryResult>> =>
      ipcRenderer.invoke('photos:list'),
    pickMedia: (): Promise<Result<PickedPhotoUploadFile[]>> =>
      ipcRenderer.invoke('photos:pickMedia'),
    registerDroppedMedia: (files: File[]): Promise<Result<PickedPhotoUploadFile[]>> => {
      const paths = Array.from(files)
        .map(file => {
          try { return webUtils.getPathForFile(file); }
          catch { return ''; }
        })
        .filter((path): path is string => Boolean(path));
      return ipcRenderer.invoke('photos:registerDroppedMedia', paths);
    },
    upload: (args: { uploadId: string }): Promise<Result<{ key: string }>> =>
      ipcRenderer.invoke('photos:upload', args),
    downloadZip: (args: { keys: string[]; jobKey: string }): Promise<Result<string | null>> =>
      ipcRenderer.invoke('photos:downloadZip', args),
  },
  shell: {
    openExternal: (url: string): Promise<Result<true>> =>
      ipcRenderer.invoke('shell:openExternal', url),
    fetchAWSStatus: (): Promise<Result<string>> =>
      ipcRenderer.invoke('shell:fetchAWSStatus'),
  },
  app: {
    version: (): Promise<Result<string>> => ipcRenderer.invoke('app:version'),
    checkUpdate: (): Promise<Result<UpdateInfo>> => ipcRenderer.invoke('app:checkUpdate'),
    downloadAndInstall: (): Promise<Result<true>> => ipcRenderer.invoke('app:downloadAndInstall'),
  },
  gdrive: {
    init: (cfg: GDriveConfig): Promise<Result<true>> =>
      ipcRenderer.invoke('gdrive:init', cfg),
    status: (): Promise<Result<{ connected: boolean }>> =>
      ipcRenderer.invoke('gdrive:status'),
    auth: (): Promise<Result<true>> =>
      ipcRenderer.invoke('gdrive:auth'),
    list: (folderId?: string): Promise<Result<GDriveFile[]>> =>
      ipcRenderer.invoke('gdrive:list', folderId),
    transfer: (args: { files: GDriveFile[]; destPrefix: string; storageClass: StorageClass }): Promise<Result<true>> =>
      ipcRenderer.invoke('gdrive:transfer', args),
    disconnect: (): Promise<Result<true>> =>
      ipcRenderer.invoke('gdrive:disconnect'),
  }
};

try {
  contextBridge.exposeInMainWorld('s3drive', api);
  console.log('[Preload] s3drive exposed successfully');
} catch (e) {
  console.error('[Preload] exposeInMainWorld FAILED:', e);
}

export type S3DriveAPI = typeof api;
