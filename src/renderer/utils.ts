import { STORAGE_CLASSES, StorageClassInfo } from '@shared/types';

export function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function basename(key: string): string {
  if (key.endsWith('/')) {
    const trimmed = key.slice(0, -1);
    return trimmed.split('/').pop() ?? trimmed;
  }
  return key.split('/').pop() ?? key;
}

export function tierInfo(storageClass: string): StorageClassInfo {
  return STORAGE_CLASSES.find(c => c.id === storageClass)
    ?? STORAGE_CLASSES[0];
}

const PREVIEW_INLINE_TYPES = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'pdf'
]);

export function canPreviewInline(key: string): boolean {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return PREVIEW_INLINE_TYPES.has(ext);
}
