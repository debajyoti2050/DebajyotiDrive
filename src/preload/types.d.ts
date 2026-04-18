import type { S3DriveAPI } from './index';

declare global {
  interface Window {
    s3drive: S3DriveAPI;
  }
}

export {};
