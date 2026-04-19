import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { AppConfig, BucketAnalytics, FolderInfo, S3Object, StorageClass, UploadProgress } from '@shared/types';
import { STORAGE_CLASSES } from '@shared/types';
import { Logo } from './Logo';
import { AuroraBackground } from './AuroraBackground';
import {
  BarChartIcon, CloudUploadIcon, FolderIcon, FolderPlusIcon,
  GoogleDriveIcon, GridIcon, HistoryIcon, HomeIcon, ListIcon,
  MoonIcon, MonitorIcon, SunIcon,
  getTileIcon, isPreviewable,
} from './Icons';

type Theme = 'system' | 'dark' | 'light';

const TIER_COLORS_MAP: Record<number, string> = {
  1: '#f472b6', 2: '#a78bfa', 3: '#60a5fa', 4: '#34d399', 5: '#6b7280',
};

// ── Animation variants ─────────────────────────────────────────────────────
const rowVariants = {
  hidden: { opacity: 0, x: -14 },
  visible: (i: number) => ({
    opacity: 1, x: 0,
    transition: { delay: Math.min(i, 25) * 0.032, duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] as const }
  }),
};
const sidebarBtnVariants = {
  rest: { x: 0 },
  hover: { x: 4, transition: { type: 'spring' as const, damping: 18, stiffness: 320 } },
  tap: { scale: 0.96, x: 0 },
};
import { basename, canPreviewInline, formatBytes, formatDate, formatINR, tierInfo } from './utils';
import { SettingsModal } from './SettingsModal';
import { UploadModal } from './UploadModal';
import { UploadPanel, UploadJob } from './UploadPanel';
import { ShareModal } from './ShareModal';
import { VersionsModal } from './VersionsModal';
import { PreviewModal } from './PreviewModal';
import { DashboardModal } from './DashboardModal';
import { RestoreModal } from './RestoreModal';
import { NewFolderModal } from './NewFolderModal';
import { GoogleDriveModal } from './GoogleDriveModal';
import { ChangeTierModal } from './ChangeTierModal';
import { AWSStatusModal } from './AWSStatusModal';

type Toast = { msg: string; kind: 'info' | 'error' | 'success' } | null;

export const App: React.FC = () => {
  // Multi-bucket state
  const [configs, setConfigs] = useState<AppConfig[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [configLoaded, setConfigLoaded] = useState(false);
  const config = configs[activeIndex] ?? null;

  // Navigation state
  const [prefix, setPrefix] = useState('');
  const [history, setHistory] = useState<string[]>(['']);
  const [historyIdx, setHistoryIdx] = useState(0);
  const canGoBack = historyIdx > 0;
  const canGoForward = historyIdx < history.length - 1;

  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [files, setFiles] = useState<S3Object[]>([]);
  const [loading, setLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<S3Object[] | null>(null);
  const [storageClassFilter, setStorageClassFilter] = useState('');

  // Drag-and-drop state — use a ref for draggedKey so onDrop always reads the
  // current value, not a stale closure capture.
  const draggedKeyRef = useRef<string | null>(null);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [dropZoneActive, setDropZoneActive] = useState(false);

  // Modals
  const [showSettings, setShowSettings] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showGDrive, setShowGDrive] = useState(false);
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [showChangeTier, setShowChangeTier] = useState(false);
  const [showAWSStatus, setShowAWSStatus] = useState(false);
  const [shareKey, setShareKey] = useState<string | null>(null);
  const [versionsKey, setVersionsKey] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<{ key: string; storageClass: string } | null>(null);

  // Bucket-wide analytics (loaded async in background)
  const [bucketBytes, setBucketBytes] = useState<number | null>(null);
  const [bucketAnalytics, setBucketAnalytics] = useState<BucketAnalytics | null>(null);

  // View mode: list (default) or tiles
  const [viewMode, setViewMode] = useState<'list' | 'tiles'>('list');

  // Presigned URLs for tile previews, keyed by S3 key
  const [tileUrls, setTileUrls] = useState<Record<string, string>>({});

  // Live clock for status bar
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );

  // Theme: 'system' uses OS preference, 'dark'/'light' are manual overrides
  // Initializer runs synchronously before first paint to avoid flash
  const [theme, setTheme] = useState<Theme>(() => {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    return 'system';
  });
  const cycleTheme = () => setTheme(t => t === 'system' ? 'dark' : t === 'dark' ? 'light' : 'system');

  // Transfer jobs (uploads + downloads)
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>([]);
  const uploadJobsRef = useRef<UploadJob[]>([]);
  uploadJobsRef.current = uploadJobs;
  const [downloadJobs, setDownloadJobs] = useState<UploadJob[]>([]);

  const [toast, setToast] = useState<Toast>(null);
  const showToast = useCallback((msg: string, kind: 'info' | 'error' | 'success' = 'info') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Boot
  useEffect(() => {
    (async () => {
      if (typeof window.s3drive.config.getAll === 'function') {
        const res = await window.s3drive.config.getAll();
        setConfigLoaded(true);
        if (res.ok && res.value && res.value.buckets.length > 0) {
          setConfigs(res.value.buckets);
          setActiveIndex(res.value.activeIndex);
        } else {
          setShowSettings(true);
        }
      } else {
        const res = await window.s3drive.config.get();
        setConfigLoaded(true);
        if (res.ok && res.value) {
          setConfigs([res.value]);
          setActiveIndex(0);
        } else {
          setShowSettings(true);
        }
      }
    })();
  }, []);

  // Upload progress
  useEffect(() => {
    const off = window.s3drive.s3.onUploadProgress((p: UploadProgress) => {
      const now = Date.now();
      setUploadJobs(prev => prev.map(j => {
        if (j.key !== p.key || j.queued) return j;
        const elapsed = Math.max((now - (j.startTime || now)) / 1000, 0.1);
        return { ...j, loaded: p.loaded, total: p.total || j.total, done: p.done, error: p.error, speed: p.loaded / elapsed };
      }));
    });
    return off;
  }, []);

  // Fetch bucket analytics in the background whenever the active config changes
  useEffect(() => {
    if (!config) return;
    setBucketBytes(null);
    setBucketAnalytics(null);
    window.s3drive.s3.analytics().then(res => {
      if (res.ok) {
        setBucketBytes(res.value.totalBytes);
        setBucketAnalytics(res.value);
      }
    });
  }, [config]);

  // Live clock — ticks every minute
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  // Apply theme to <html data-theme="...">
  useEffect(() => {
    const apply = (t: Theme) => {
      const isDark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    };
    apply(theme);
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => apply('system');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme]);

  // Presign image/video URLs when tiles view is active
  useEffect(() => {
    if (viewMode !== 'tiles' || !config) return;
    const currentFiles = searchResults ?? files;
    const toSign = currentFiles
      .filter(f => (isPreviewable(f.key, 'image') || isPreviewable(f.key, 'video')) && !tileUrls[f.key])
      .slice(0, 60);
    if (!toSign.length) return;
    Promise.all(
      toSign.map(f => window.s3drive.s3.presign({ key: f.key, expiresInSeconds: 3600 })
        .then(r => r.ok ? { key: f.key, url: r.value } : null))
    ).then(results => {
      const next: Record<string, string> = {};
      for (const r of results) if (r) next[r.key] = r.url;
      setTileUrls(prev => ({ ...prev, ...next }));
    });
  }, [viewMode, files, searchResults, config]); // eslint-disable-line react-hooks/exhaustive-deps

  // Download progress
  useEffect(() => {
    const off = window.s3drive.s3.onDownloadProgress((p: UploadProgress) => {
      const now = Date.now();
      setDownloadJobs(prev => prev.map(j => {
        if (j.key !== p.key) return j;
        const elapsed = Math.max((now - j.startTime) / 1000, 0.1);
        return { ...j, loaded: p.loaded, total: p.total || j.total, done: p.done, error: p.error, speed: p.loaded / elapsed };
      }));
    });
    return off;
  }, []);

  const refresh = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    const res = await window.s3drive.s3.list(prefix);
    setLoading(false);
    if (!res.ok) { showToast(res.error, 'error'); return; }
    setFolders(res.value.folders);
    setFiles(res.value.files);
  }, [config, prefix, showToast]);

  useEffect(() => { if (searchResults === null) refresh(); }, [refresh, searchResults]);

  useEffect(() => {
    if (!config) return;
    const q = searchQuery.trim();
    if (!q) { setSearchResults(null); return; }
    const h = setTimeout(async () => {
      setLoading(true);
      const res = await window.s3drive.s3.search(q);
      setLoading(false);
      if (!res.ok) { showToast(res.error, 'error'); return; }
      setSearchResults(res.value);
    }, 300);
    return () => clearTimeout(h);
  }, [searchQuery, config, showToast]);

  // ── Navigation ──────────────────────────────────────────────────────────────

  const goBack = () => {
    if (historyIdx <= 0) return;
    const newIdx = historyIdx - 1;
    setHistoryIdx(newIdx);
    setSearchQuery('');
    setSearchResults(null);
    setPrefix(history[newIdx]);
  };

  const goForward = () => {
    if (historyIdx >= history.length - 1) return;
    const newIdx = historyIdx + 1;
    setHistoryIdx(newIdx);
    setSearchQuery('');
    setSearchResults(null);
    setPrefix(history[newIdx]);
  };

  // Standalone navigate that properly pushes history (avoids stale closure in navigateToFolder)
  const navigate = (fp: string) => {
    setSearchQuery('');
    setSearchResults(null);
    setSelectedFolders(new Set());
    setPrefix(fp);
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIdx + 1);
      if (trimmed[trimmed.length - 1] === fp) return trimmed;
      return [...trimmed, fp];
    });
    setHistoryIdx(prev => prev + 1);
  };

  // ── Config ──────────────────────────────────────────────────────────────────

  const saveConfig = async (cfg: AppConfig): Promise<string | null> => {
    const res = await window.s3drive.config.set(cfg);
    if (!res.ok) return res.error;
    if (typeof window.s3drive.config.getAll === 'function') {
      const allRes = await window.s3drive.config.getAll();
      if (allRes.ok && allRes.value) {
        setConfigs(allRes.value.buckets);
        setActiveIndex(allRes.value.activeIndex);
      }
    } else {
      setConfigs(prev => {
        const exists = prev.findIndex(b => b.bucket === cfg.bucket && b.region === cfg.region);
        if (exists >= 0) { const next = [...prev]; next[exists] = cfg; setActiveIndex(exists); return next; }
        setActiveIndex(prev.length);
        return [...prev, cfg];
      });
    }
    setPrefix('');
    setHistory(['']); setHistoryIdx(0);
    showToast('Connected to ' + cfg.bucket, 'success');
    return null;
  };

  const switchBucket = async (index: number) => {
    if (typeof window.s3drive.config.setActive === 'function') {
      const res = await window.s3drive.config.setActive(index);
      if (!res.ok || !res.value) { showToast('Failed to switch bucket', 'error'); return; }
    }
    setActiveIndex(index);
    setPrefix(''); setHistory(['']); setHistoryIdx(0);
    setSearchQuery(''); setSearchResults(null);
    showToast(`Switched to ${configs[index]?.bucket}`, 'success');
  };

  const removeBucket = async (index: number) => {
    if (!confirm(`Remove "${configs[index]?.bucket}" from saved buckets?`)) return;
    if (typeof window.s3drive.config.remove === 'function') {
      const res = await window.s3drive.config.remove(index);
      if (!res.ok) { showToast(res.error, 'error'); return; }
    }
    setConfigs(prev => {
      const next = prev.filter((_, i) => i !== index);
      setActiveIndex(idx => Math.min(idx, next.length - 1));
      return next;
    });
    showToast('Bucket removed', 'info');
  };

  // ── File operations ─────────────────────────────────────────────────────────

  const createFolder = async (name: string) => {
    setShowNewFolder(false);
    const res = await window.s3drive.s3.createFolder(`${prefix}${name}`);
    if (!res.ok) { showToast(res.error, 'error'); return; }
    showToast(`Folder "${name}" created`, 'success');
    refresh();
  };

  const MAX_CONCURRENT = 10;

  const handleUploadStart = (picked: { localPath: string; name: string }[], sc: StorageClass) => {
    setShowUpload(false);
    const ts = Date.now();
    const jobs: UploadJob[] = picked.map((f, i) => ({
      id: `${ts}-${i}`, name: f.name,
      key: `${prefix}${f.name}`, localPath: f.localPath,
      loaded: 0, total: 0, done: false,
      startTime: 0, speed: 0, type: 'upload' as const,
      queued: i >= MAX_CONCURRENT,
    }));
    setUploadJobs(prev => [...prev, ...jobs]);

    (async () => {
      for (let i = 0; i < jobs.length; i += MAX_CONCURRENT) {
        const batch = jobs.slice(i, i + MAX_CONCURRENT);
        const batchStart = Date.now();
        setUploadJobs(prev => prev.map(j =>
          batch.some(b => b.id === j.id) ? { ...j, queued: false, startTime: batchStart } : j
        ));
        await Promise.all(batch.map(job =>
          window.s3drive.s3.upload({ localPath: job.localPath, key: job.key, storageClass: sc })
        ));
      }
      refresh();
    })();
  };

  const handleGDriveTransfer = (transferred: { name: string; key: string }[]) => {
    const ts = Date.now();
    const jobs: UploadJob[] = transferred.map((f, i) => ({
      id: `gdrive-${ts}-${i}`, name: f.name, key: f.key, localPath: '',
      loaded: 0, total: 0, done: false,
      startTime: ts, speed: 0, type: 'upload' as const,
    }));
    setUploadJobs(prev => [...prev, ...jobs]);
    refresh();
  };

  const deleteFolderAction = async (folderPrefix: string) => {
    const name = folderPrefix.replace(/\/$/, '').split('/').pop() ?? folderPrefix;
    if (!confirm(`Delete folder "${name}" and ALL its contents? This cannot be undone.`)) return;
    const res = await window.s3drive.s3.deleteFolder(folderPrefix);
    if (!res.ok) { showToast(res.error, 'error'); return; }
    showToast(`Deleted "${name}" (${res.value} object${res.value !== 1 ? 's' : ''})`, 'success');
    setSelectedFolders(prev => { const next = new Set(prev); next.delete(folderPrefix); return next; });
    refresh();
  };

  const downloadFoldersAction = async (prefixes: string[]) => {
    const jobKey = `zip-${Date.now()}`;
    const firstName = prefixes[0].replace(/\/$/, '').split('/').pop() ?? 'folder';
    const zipName = prefixes.length === 1 ? `${firstName}.zip` : `folders-${Date.now()}.zip`;
    const job: UploadJob = {
      id: jobKey, name: zipName, key: jobKey, localPath: '',
      loaded: 0, total: 0, done: false,
      startTime: Date.now(), speed: 0, type: 'download',
    };
    setDownloadJobs(prev => [...prev, job]);
    const res = await window.s3drive.s3.downloadFoldersAsZip({ prefixes, zipName, jobKey });
    if (!res.ok) {
      setDownloadJobs(prev => prev.map(j => j.id === jobKey ? { ...j, done: true, error: res.error } : j));
      showToast(res.error, 'error');
      return;
    }
    if (!res.value) {
      setDownloadJobs(prev => prev.filter(j => j.id !== jobKey));
      return;
    }
    setDownloadJobs(prev => prev.map(j => j.id === jobKey ? { ...j, done: true, localPath: res.value! } : j));
    showToast(`Saved ${zipName}`, 'success');
    setSelectedFolders(new Set());
  };

  const cancelUpload = async (jobId: string) => {
    const job = uploadJobsRef.current.find(j => j.id === jobId);
    if (!job || job.queued) {
      // For queued (not yet started) jobs, just mark done/cancelled locally
      setUploadJobs(prev => prev.map(j => j.id === jobId ? { ...j, done: true, error: 'Cancelled', queued: false } : j));
      return;
    }
    await window.s3drive.s3.cancelUpload(job.key);
  };

  const downloadFile = async (key: string) => {
    const obj = (searchResults ?? files).find(f => f.key === key);
    if (obj) {
      const info = STORAGE_CLASSES.find(c => c.id === obj.storageClass);
      if (info && !info.instantRetrieve) { setRestoreTarget({ key, storageClass: obj.storageClass }); return; }
    }
    const jobId = `dl-${Date.now()}`;
    const name = key.split('/').pop() ?? key;
    const job: UploadJob = {
      id: jobId, name, key, localPath: '',
      loaded: 0, total: obj?.size ?? 0, done: false,
      startTime: Date.now(), speed: 0, type: 'download'
    };
    setDownloadJobs(prev => [...prev, job]);
    const res = await window.s3drive.s3.download({ key });
    if (!res.ok) {
      setDownloadJobs(prev => prev.map(j => j.id === jobId ? { ...j, done: true, error: res.error } : j));
      showToast(res.error, 'error');
      return;
    }
    if (!res.value) {
      // User cancelled the save dialog
      setDownloadJobs(prev => prev.filter(j => j.id !== jobId));
      return;
    }
    setDownloadJobs(prev => prev.map(j => j.id === jobId ? { ...j, done: true, localPath: res.value! } : j));
    showToast(`Saved to ${res.value}`, 'success');
  };

  const deleteFile = async (key: string) => {
    if (!confirm(`Delete "${basename(key)}"? This may be permanent if versioning is off.`)) return;
    const res = await window.s3drive.s3.delete({ key });
    if (!res.ok) { showToast(res.error, 'error'); return; }
    showToast('Deleted', 'success');
    refresh();
  };

  const openFile = (f: S3Object) => {
    const info = STORAGE_CLASSES.find(c => c.id === f.storageClass);
    if (info && !info.instantRetrieve) { setRestoreTarget({ key: f.key, storageClass: f.storageClass }); return; }
    if (canPreviewInline(f.key)) { setPreviewKey(f.key); return; }
    downloadFile(f.key);
  };

  const bulkChangeTier = async (sc: StorageClass) => {
    setShowChangeTier(false);
    const keys = Array.from(selectedFiles);
    let done = 0;
    for (const key of keys) {
      const res = await window.s3drive.s3.changeStorageClass({ key, storageClass: sc });
      if (!res.ok) { showToast(`Failed: ${basename(key)} — ${res.error}`, 'error'); return; }
      done++;
    }
    showToast(`Tier changed for ${done} file${done !== 1 ? 's' : ''}`, 'success');
    setSelectedFiles(new Set());
    refresh();
  };

  const enableVersioning = async () => {
    if (!confirm('Enable versioning? Every PUT creates a new version. Old versions cost storage.')) return;
    const res = await window.s3drive.s3.enableVersioning();
    if (!res.ok) { showToast(res.error, 'error'); return; }
    showToast('Versioning enabled', 'success');
  };

  // ── Drag and drop ───────────────────────────────────────────────────────────

  const moveFile = async (sourceKey: string, targetFolderPrefix: string) => {
    const name = basename(sourceKey);
    const destKey = `${targetFolderPrefix}${name}`;
    if (sourceKey === destKey) return;
    const res = await window.s3drive.s3.move({ sourceKey, destKey });
    if (!res.ok) { showToast(res.error, 'error'); return; }
    showToast(`Moved "${name}" to /${targetFolderPrefix || '(root)'}`, 'success');
    refresh();
  };

  // External OS file drop onto the content area
  const handleContentDrop = async (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDropZoneActive(false);
    if (draggedKeyRef.current) return; // internal drag handled by folder row drop
    const fileList = Array.from(e.dataTransfer.files);
    if (!fileList.length) return;
    // Electron extends File with .path
    const picked = fileList
      .map((f: File & { path?: string }) => ({ localPath: f.path ?? '', name: f.name }))
      .filter(f => f.localPath);
    if (!picked.length) return;
    handleUploadStart(picked, 'STANDARD');
  };

  // ── Derived state ───────────────────────────────────────────────────────────

  const showingSearch = searchResults !== null;
  const rows = useMemo(() => {
    const base = searchResults ?? files;
    return storageClassFilter ? base.filter(f => f.storageClass === storageClassFilter) : base;
  }, [searchResults, files, storageClassFilter]);

  const breadcrumbs = useMemo(() => {
    const parts = prefix.split('/').filter(Boolean);
    const crumbs: { label: string; prefix: string }[] = [{ label: config?.bucket ?? 'bucket', prefix: '' }];
    let running = '';
    for (const p of parts) { running += p + '/'; crumbs.push({ label: p, prefix: running }); }
    return crumbs;
  }, [prefix, config?.bucket]);

  const storageBar = useMemo(() => {
    if (!files.length) return null;
    const total = files.reduce((s, f) => s + f.size, 0);
    const byTier = STORAGE_CLASSES.map(sc => {
      const bytes = files.filter(f => f.storageClass === sc.id).reduce((s, f) => s + f.size, 0);
      return { sc, bytes, pct: total > 0 ? (bytes / total) * 100 : 0 };
    }).filter(t => t.bytes > 0);
    return { total, byTier, fileCount: files.length, folderCount: folders.length };
  }, [files, folders]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="app">
      {/* Titlebar */}
      <div className="titlebar">
        <motion.div
          className="titlebar-brand"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <Logo size={28} />
          <span className="titlebar-name">S3Drive</span>
          <AnimatePresence>
            {bucketBytes !== null && (
              <motion.span
                className="titlebar-storage-pill"
                initial={{ opacity: 0, scale: 0.8, x: -8 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ type: 'spring', damping: 20, stiffness: 280 }}
              >
                {formatBytes(bucketBytes)} used
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
        <motion.div
          className="titlebar-actions"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          {configs.length > 1 ? (
            <select className="bucket-switcher" value={activeIndex} onChange={e => switchBucket(Number(e.target.value))}>
              {configs.map((c, i) => <option key={i} value={i}>{c.bucket} · {c.region}</option>)}
            </select>
          ) : config ? (
            <div className="titlebar-bucket">
              <strong>{config.bucket}</strong> · {config.region}
              {config.profile && ` · ${config.profile}`}
            </div>
          ) : null}
          {/* Powered by AWS badge */}
          <motion.div
            className="powered-by-aws"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4, duration: 0.4 }}
          >
            <span className="pba-text">Powered by</span>
            <svg width="26" height="16" viewBox="0 0 80 32" fill="none" className="pba-logo">
              <path d="M22.5 14c0 1.1-.9 2-2 2h-6c-1.1 0-2-.9-2-2v-4c0-1.1.9-2 2-2h6c1.1 0 2 .9 2 2v4z" fill="#FF9900"/>
              <path d="M35 8h-6c-1.1 0-2 .9-2 2v6h10V10c0-1.1-.9-2-2-2z" fill="#FF9900" opacity="0.8"/>
              <path d="M5 22c9.9 4.5 21.2 6.8 33 6.8 9.1 0 19.3-1.9 28.5-5.6.4-.2.5-.7.1-.9-.4-.2-.9-.1-1.3.1C56 26.6 46.8 28 38 28 26.3 28 15 25.5 5.8 20.8c-.4-.2-.9 0-1 .4-.1.4.2.8.2.8z" fill="#FF9900"/>
            </svg>
          </motion.div>

          <motion.button
            className="theme-toggle-btn"
            onClick={cycleTheme}
            title={`Theme: ${theme} — click to cycle`}
            whileHover={{ scale: 1.12, rotate: theme === 'light' ? 20 : theme === 'dark' ? -15 : 0 }}
            whileTap={{ scale: 0.88 }}
            transition={{ type: 'spring', stiffness: 400, damping: 14 }}
          >
            {theme === 'light' ? <SunIcon size={14} /> : theme === 'dark' ? <MoonIcon size={14} /> : <MonitorIcon size={14} />}
          </motion.button>
          <motion.button
            className="btn"
            onClick={() => setShowSettings(true)}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', damping: 18, stiffness: 350 }}
          >Settings</motion.button>
        </motion.div>
      </div>

      {/* Main layout */}
      <div className="main">
        <motion.aside
          className="sidebar"
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <div className="sidebar-section">
            {/* Upload — pulsing beacon */}
            <motion.button
              className="sidebar-button primary"
              onClick={() => setShowUpload(true)}
              disabled={!config}
              variants={sidebarBtnVariants}
              initial="rest" whileHover="hover" whileTap="tap"
              animate={config ? { boxShadow: ['0 0 8px rgba(155,92,246,0.2),0 2px 8px rgba(0,0,0,0.4)','0 0 22px rgba(155,92,246,0.55),0 4px 16px rgba(0,0,0,0.4)','0 0 8px rgba(155,92,246,0.2),0 2px 8px rgba(0,0,0,0.4)'] } : {}}
              transition={{ boxShadow: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }, default: { type: 'spring', damping: 18, stiffness: 320 } }}
            >
              <motion.span className="sidebar-btn-icon" whileHover={{ y: -2 }} transition={{ type: 'spring', stiffness: 400, damping: 15 }}>
                <CloudUploadIcon size={15} />
              </motion.span>
              Upload files
            </motion.button>

            <motion.button
              className="sidebar-button"
              onClick={() => setShowNewFolder(true)}
              disabled={!config}
              style={{ marginTop: 5 }}
              variants={sidebarBtnVariants}
              initial="rest" whileHover="hover" whileTap="tap"
              transition={{ type: 'spring', damping: 18, stiffness: 320 }}
            >
              <motion.span className="sidebar-btn-icon" whileHover={{ rotate: 90, scale: 1.2 }} transition={{ type: 'spring', stiffness: 400, damping: 12 }}>
                <FolderPlusIcon size={15} />
              </motion.span>
              New folder
            </motion.button>

            <motion.button
              className="sidebar-button sidebar-button-gdrive"
              onClick={() => setShowGDrive(true)}
              disabled={!config}
              style={{ marginTop: 5 }}
              variants={sidebarBtnVariants}
              initial="rest" whileHover="hover" whileTap="tap"
              transition={{ type: 'spring', damping: 18, stiffness: 320 }}
            >
              <motion.span className="sidebar-btn-icon" whileHover={{ rotate: [0, -8, 8, 0], scale: 1.15 }} transition={{ duration: 0.4 }}>
                <GoogleDriveIcon size={15} />
              </motion.span>
              From Google Drive
            </motion.button>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-label">Search</div>
            <motion.input
              className="search-box"
              placeholder="Find in bucket…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              disabled={!config}
              whileFocus={{ scale: 1.01, boxShadow: '0 0 0 2px rgba(155,92,246,0.35)' }}
              transition={{ duration: 0.15 }}
            />
          </div>

          <div className="sidebar-section">
            <div className="sidebar-label">Filter by tier</div>
            <select
              className="tier-filter-select"
              value={storageClassFilter}
              onChange={e => setStorageClassFilter(e.target.value)}
              disabled={!config}
            >
              <option value="">All tiers</option>
              {STORAGE_CLASSES.map(sc => <option key={sc.id} value={sc.id}>{sc.label}</option>)}
            </select>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-label">Bucket</div>
            {[
              { label: 'Analytics', icon: <BarChartIcon size={14} />, action: () => setShowDashboard(true), iconAnim: { y: [0, -3, 0] as number[] } },
              { label: 'Root / Home', icon: <HomeIcon size={14} />, action: () => navigate(''), iconAnim: { scale: [1, 1.2, 1] as number[] } },
              { label: 'Enable versioning', icon: <HistoryIcon size={14} />, action: enableVersioning, iconAnim: { rotate: [0, -360] as number[] } },
            ].map(({ label, icon, action, iconAnim }) => (
              <motion.button
                key={label}
                className="sidebar-button"
                onClick={action}
                disabled={!config}
                variants={sidebarBtnVariants}
                initial="rest" whileHover="hover" whileTap="tap"
                transition={{ type: 'spring', damping: 18, stiffness: 320 }}
              >
                <motion.span className="sidebar-btn-icon" whileHover={iconAnim} transition={{ duration: 0.5, ease: 'easeInOut' }}>
                  {icon}
                </motion.span>
                {label}
              </motion.button>
            ))}
          </div>

          <div className="sidebar-section" style={{ marginTop: 'auto' }}>
            <div className="sidebar-label">Storage tiers</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.7 }}>
              {STORAGE_CLASSES.map((sc, i) => (
                <motion.div
                  key={sc.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + i * 0.06 }}
                >
                  <span className="tier-chip" data-tier={sc.costTier} style={{ padding: '0 4px' }}>{sc.label}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.aside>

        <main
          className={`content${dropZoneActive ? ' drop-zone-active' : ''}`}
          style={{ position: 'relative' }}
          onDragOver={e => { e.preventDefault(); if (!draggedKey) setDropZoneActive(true); }}
          onDragLeave={e => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropZoneActive(false);
          }}
          onDrop={handleContentDrop}
        >
          {/* Continuous aurora background */}
          <AuroraBackground />

          {/* ── Sneak-peek analytics strip ───────────────────────────────── */}
          <AnimatePresence>
            {bucketAnalytics && (
              <motion.div
                className="mini-analytics"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                onClick={() => setShowDashboard(true)}
                title="Click for full analytics"
                style={{ position: 'relative', zIndex: 1 }}
              >
                {/* Tier distribution bar */}
                <div className="mini-analytics-bar">
                  {bucketAnalytics.byTier.map((t, i) => {
                    const pct = bucketAnalytics.totalBytes > 0
                      ? (t.totalBytes / bucketAnalytics.totalBytes) * 100 : 0;
                    return (
                      <motion.div
                        key={t.storageClass}
                        className="mini-analytics-seg"
                        data-tier={STORAGE_CLASSES.find(c => c.id === t.storageClass)?.costTier ?? 1}
                        title={`${STORAGE_CLASSES.find(c => c.id === t.storageClass)?.label}: ${pct.toFixed(1)}%`}
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ delay: 0.1 + i * 0.08, duration: 0.7, ease: [0.34, 1.56, 0.64, 1] }}
                        style={{ transformOrigin: 'left', width: `${pct}%` }}
                      />
                    );
                  })}
                </div>

                {/* Stats row */}
                <div className="mini-analytics-stats">
                  {/* Mini vertical bar chart */}
                  <svg
                    width={bucketAnalytics.byTier.length * 9}
                    height="20"
                    style={{ flexShrink: 0, alignSelf: 'center' }}
                  >
                    {(() => {
                      const maxB = Math.max(...bucketAnalytics.byTier.map(t => t.totalBytes), 1);
                      return bucketAnalytics.byTier.map((t, i) => {
                        const h = Math.max(2, Math.round((t.totalBytes / maxB) * 16));
                        const sc = STORAGE_CLASSES.find(c => c.id === t.storageClass);
                        const col = TIER_COLORS_MAP[sc?.costTier ?? 1];
                        return (
                          <motion.rect key={t.storageClass}
                            x={i * 9} y={20 - h} width={7} height={h}
                            fill={col} rx={1}
                            initial={{ height: 0, y: 20 }}
                            animate={{ height: h, y: 20 - h }}
                            transition={{ delay: 0.15 + i * 0.07, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
                          />
                        );
                      });
                    })()}
                  </svg>
                  <span className="mini-analytics-sep" style={{ marginLeft: 4 }}>·</span>
                  <motion.span
                    className="mini-analytics-stat"
                    animate={{ opacity: [0.7, 1, 0.7] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <span className="mini-analytics-dot" />
                    {formatBytes(bucketAnalytics.totalBytes)}
                  </motion.span>
                  <span className="mini-analytics-sep">·</span>
                  <span className="mini-analytics-stat">{bucketAnalytics.totalObjects.toLocaleString()} objects</span>
                  <span className="mini-analytics-sep">·</span>
                  <motion.span
                    className="mini-analytics-cost"
                    animate={{ opacity: [0.75, 1, 0.75] }}
                    transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
                    title={`≈ $${bucketAnalytics.estimatedMonthlyCost.toFixed(2)}/mo USD`}
                  >
                    {formatINR(bucketAnalytics.estimatedMonthlyCost)}/mo
                  </motion.span>
                  <span className="mini-analytics-sep">·</span>
                  <motion.span
                    className="mini-analytics-cta"
                    whileHover={{ x: 3 }}
                    transition={{ type: 'spring', stiffness: 400 }}
                  >
                    View analytics →
                  </motion.span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Storage analytics bar */}
          {storageBar && (
            <div className="storage-bar" style={{ position: 'relative', zIndex: 1 }}>
              <motion.div
                className="storage-bar-info"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
              >
                <span>{storageBar.folderCount} folder{storageBar.folderCount !== 1 ? 's' : ''}</span>
                <span className="storage-bar-sep">·</span>
                <span>{storageBar.fileCount} file{storageBar.fileCount !== 1 ? 's' : ''}</span>
                <span className="storage-bar-sep">·</span>
                <span>{formatBytes(storageBar.total)} used</span>
              </motion.div>
              <div className="storage-bar-track">
                {storageBar.byTier.map(({ sc, pct }, i) => (
                  <motion.div
                    key={sc.id}
                    className="storage-bar-segment"
                    data-tier={sc.costTier}
                    title={`${sc.label}: ${pct.toFixed(1)}%`}
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: `${pct}%`, opacity: 1 }}
                    transition={{ duration: 0.8, delay: 0.15 + i * 0.1, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Navigation bar — breadcrumb + back/forward */}
          <div className="nav-bar" style={{ position: 'relative', zIndex: 1 }}>
            <div className="nav-arrows">
              {[{ label: '←', action: goBack, disabled: !canGoBack || showingSearch, title: 'Go back' },
                { label: '→', action: goForward, disabled: !canGoForward || showingSearch, title: 'Go forward' }
              ].map(({ label, action, disabled, title }) => (
                <motion.button
                  key={label}
                  className="nav-arrow-btn"
                  onClick={action}
                  disabled={disabled}
                  title={title}
                  whileHover={!disabled ? { scale: 1.15, boxShadow: '0 0 10px rgba(155,92,246,0.5)' } : {}}
                  whileTap={!disabled ? { scale: 0.88 } : {}}
                  transition={{ type: 'spring', damping: 16, stiffness: 380 }}
                >
                  {label}
                </motion.button>
              ))}
            </div>

            <div className="nav-path">
              {showingSearch ? (
                <motion.span className="nav-search-label" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  Search: <span className="nav-search-query">"{searchQuery}"</span>
                  <span className="nav-search-count"> · {rows.length} result{rows.length !== 1 ? 's' : ''}</span>
                </motion.span>
              ) : (
                breadcrumbs.map((c, i) => (
                  <React.Fragment key={c.prefix}>
                    {i > 0 && <span className="nav-sep">›</span>}
                    <motion.span
                      className={`nav-crumb${i === breadcrumbs.length - 1 ? ' current' : ''}`}
                      onClick={() => navigate(c.prefix)}
                      title={c.prefix || '/'}
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05, duration: 0.2 }}
                      whileHover={{ color: 'var(--accent)' }}
                    >
                      {i === 0 ? (
                        <span className="nav-crumb-icon">&#x229E;</span>
                      ) : (
                        <span className="nav-crumb-icon">&#x25B8;</span>
                      )}
                      {c.label}
                    </motion.span>
                  </React.Fragment>
                ))
              )}
            </div>

            {!showingSearch && (
              <div className="nav-info">
                {loading ? (
                  <span className="nav-loading">Loading…</span>
                ) : (
                  <>
                    {folders.length > 0 && <span>{folders.length} folder{folders.length !== 1 ? 's' : ''}</span>}
                    {folders.length > 0 && files.length > 0 && <span className="nav-dot">·</span>}
                    {files.length > 0 && <span>{files.length} file{files.length !== 1 ? 's' : ''}</span>}
                  </>
                )}
              </div>
            )}

            {/* View mode toggle */}
            <div className="nav-view-toggle">
              {([
                { mode: 'list' as const, Icon: ListIcon, title: 'List view' },
                { mode: 'tiles' as const, Icon: GridIcon, title: 'Tiles view' },
              ]).map(({ mode, Icon, title }) => (
                <motion.button
                  key={mode}
                  className={`nav-view-btn${viewMode === mode ? ' active' : ''}`}
                  onClick={() => setViewMode(mode)}
                  title={title}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.88 }}
                >
                  <Icon size={13} />
                </motion.button>
              ))}
            </div>
          </div>

          {/* Drop hint overlay */}
          <AnimatePresence>
            {dropZoneActive && (
              <motion.div
                className="drop-overlay"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{
                  opacity: 1, scale: 1,
                  borderColor: ['rgba(155,92,246,0.5)', 'rgba(155,92,246,1)', 'rgba(155,92,246,0.5)'],
                }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ borderColor: { duration: 1, repeat: Infinity }, scale: { duration: 0.15 } }}
              >
                <motion.div
                  className="drop-overlay-label"
                  animate={{ y: [0, -4, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                >
                  ↑ Drop files to upload to /{prefix || '(root)'}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Ambient nebula orbs — subtle background depth */}
          {config && (
            <div className="content-orbs" aria-hidden>
              {[
                { left: '15%', top: '30%', dur: 18, delay: 0 },
                { left: '55%', top: '55%', dur: 24, delay: 5 },
                { left: '78%', top: '18%', dur: 20, delay: 10 },
              ].map((orb, i) => (
                <motion.div
                  key={i}
                  className="content-orb"
                  style={{ left: orb.left, top: orb.top }}
                  animate={{ opacity: [0.15, 0.35, 0.15], scale: [1, 1.18, 0.92, 1.08, 1] }}
                  transition={{ duration: orb.dur, repeat: Infinity, ease: 'easeInOut', delay: orb.delay }}
                />
              ))}
            </div>
          )}

          {!config && configLoaded ? (
            <div className="empty" style={{ position: 'relative', zIndex: 1 }}>
              <motion.div
                className="empty-icon"
                animate={{ rotate: [0, 8, -8, 0], scale: [1, 1.1, 1] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              >
                ☁
              </motion.div>
              <motion.div className="empty-title" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                Not connected
              </motion.div>
              <motion.div className="empty-blurb" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>
                Configure your bucket and region to get started.
              </motion.div>
              <motion.button
                className="btn primary"
                style={{ marginTop: 20 }}
                onClick={() => setShowSettings(true)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, type: 'spring', damping: 18, stiffness: 280 }}
                whileHover={{ scale: 1.05, boxShadow: '0 0 20px rgba(155,92,246,0.5)' }}
                whileTap={{ scale: 0.96 }}
              >
                Open settings
              </motion.button>
            </div>
          ) : rows.length === 0 && folders.length === 0 && !loading ? (
            <div className="empty" style={{ position: 'relative', zIndex: 1 }}>
              <motion.div
                className="empty-icon"
                animate={{ y: [0, -10, 0], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              >
                &#8709;
              </motion.div>
              <motion.div className="empty-title" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                {showingSearch ? 'No matches' : 'This folder is empty'}
              </motion.div>
              <motion.div className="empty-blurb" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
                {showingSearch ? 'Try a different search term.' : 'Upload files or drop them here.'}
              </motion.div>
            </div>
          ) : viewMode === 'tiles' ? (
            /* ── Tiles view ──────────────────────────────────────────── */
            <motion.div
              className="tiles-grid"
              style={{ position: 'relative', zIndex: 1 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25 }}
            >
              {/* Folder tiles */}
              {!showingSearch && folders.map((f, i) => {
                const isSelected = selectedFolders.has(f.prefix);
                return (
                  <motion.div
                    key={f.prefix}
                    className={`tile-card tile-folder${isSelected ? ' tile-selected' : ''}`}
                    initial={{ opacity: 0, scale: 0.88, y: 12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ delay: i * 0.03, type: 'spring', damping: 22, stiffness: 300 }}
                    whileHover={{ y: -4, boxShadow: '0 8px 28px rgba(0,0,0,0.4), 0 0 12px rgba(155,92,246,0.3)' }}
                    onClick={() => navigate(f.prefix)}
                  >
                    <div className="tile-preview tile-folder-preview">
                      <motion.div
                        animate={{ y: [0, -4, 0] }}
                        transition={{ duration: 3 + i * 0.3, repeat: Infinity, ease: 'easeInOut' }}
                        style={{ fontSize: 36, lineHeight: 1 }}
                      >
                        <FolderIcon size={40} />
                      </motion.div>
                    </div>
                    <div className="tile-info">
                      <div className="tile-name" title={basename(f.prefix)}>{basename(f.prefix)}</div>
                      <div className="tile-meta" style={{ color: 'var(--accent)', fontSize: 10 }}>
                        Folder{f.size > 0 ? ` · ${formatBytes(f.size)}` : ''}
                      </div>
                    </div>
                    <div className="tile-actions">
                      <motion.button className="icon-btn" whileHover={{ scale: 1.15 }} onClick={e => { e.stopPropagation(); downloadFoldersAction([f.prefix]); }}>↓ zip</motion.button>
                      <motion.button className="icon-btn danger" whileHover={{ scale: 1.2, color: '#ff5d5d' }} onClick={e => { e.stopPropagation(); deleteFolderAction(f.prefix); }}>×</motion.button>
                    </div>
                    <input
                      type="checkbox" checked={isSelected}
                      className="tile-checkbox"
                      onChange={() => {}}
                      onClick={e => { e.stopPropagation(); setSelectedFolders(prev => { const n = new Set(prev); n.has(f.prefix) ? n.delete(f.prefix) : n.add(f.prefix); return n; }); }}
                    />
                  </motion.div>
                );
              })}

              {/* File tiles */}
              {rows.map((f, i) => {
                const info = tierInfo(String(f.storageClass));
                const isImg = isPreviewable(f.key, 'image');
                const isVid = isPreviewable(f.key, 'video');
                const previewUrl = tileUrls[f.key];
                return (
                  <motion.div
                    key={f.key}
                    className="tile-card"
                    initial={{ opacity: 0, scale: 0.88, y: 12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ delay: (folders.length + i) * 0.025, type: 'spring', damping: 22, stiffness: 300 }}
                    whileHover={{ y: -4, boxShadow: '0 8px 28px rgba(0,0,0,0.4), 0 0 12px rgba(155,92,246,0.3)' }}
                    onClick={() => openFile(f)}
                  >
                    <div className="tile-preview">
                      {isImg && previewUrl ? (
                        <img src={previewUrl} alt={basename(f.key)} className="tile-img" />
                      ) : isVid && previewUrl ? (
                        <video src={previewUrl} className="tile-img" muted playsInline />
                      ) : (
                        <motion.div
                          style={{ color: 'var(--text-faint)', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}
                          animate={{ opacity: [0.5, 0.9, 0.5] }}
                          transition={{ duration: 3 + i * 0.2, repeat: Infinity, ease: 'easeInOut' }}
                        >
                          {getTileIcon(f.key)}
                        </motion.div>
                      )}
                    </div>
                    <div className="tile-info">
                      <div className="tile-name" title={showingSearch ? f.key : basename(f.key)}>
                        {showingSearch ? f.key : basename(f.key)}
                      </div>
                      <div className="tile-meta">
                        <span>{formatBytes(f.size)}</span>
                        <span className="tier-chip" data-tier={info.costTier} style={{ fontSize: 9, padding: '1px 5px' }}>{info.label}</span>
                      </div>
                    </div>
                    <div className="tile-actions">
                      <motion.button className="icon-btn" whileHover={{ scale: 1.12 }} onClick={e => { e.stopPropagation(); downloadFile(f.key); }}>↓</motion.button>
                      <motion.button className="icon-btn" whileHover={{ scale: 1.12 }} onClick={e => { e.stopPropagation(); setShareKey(f.key); }}>share</motion.button>
                      <motion.button className="icon-btn danger" whileHover={{ scale: 1.2, color: '#ff5d5d' }} onClick={e => { e.stopPropagation(); deleteFile(f.key); }}>×</motion.button>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          ) : (
            <table className="table" style={{ position: 'relative', zIndex: 1}}>
              <thead>
                <tr>
                  <th style={{ width: '44%' }}>Name</th>
                  <th style={{ width: '12%' }}>Size</th>
                  <th style={{ width: '14%' }}>Modified</th>
                  <th style={{ width: '16%' }}>Storage</th>
                  <th style={{ width: '14%', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {!showingSearch && folders.map((f, idx) => {
                  const isSelected = selectedFolders.has(f.prefix);
                  const hasDate = f.lastModified && f.lastModified !== new Date(0).toISOString();
                  return (
                  <motion.tr
                    key={f.prefix}
                    custom={idx}
                    variants={rowVariants}
                    initial="hidden"
                    animate="visible"
                    onClick={() => navigate(f.prefix)}
                    onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverFolder(f.prefix); }}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverFolder(null); }}
                    onDrop={e => {
                      e.preventDefault(); e.stopPropagation();
                      setDragOverFolder(null);
                      const key = draggedKeyRef.current || e.dataTransfer.getData('text/plain');
                      if (key) { moveFile(key, f.prefix); draggedKeyRef.current = null; setDraggedKey(null); }
                    }}
                    className={`${dragOverFolder === f.prefix ? 'drag-target' : ''}${isSelected ? ' row-selected' : ''}`}
                    whileHover={{ backgroundColor: isSelected ? 'rgba(155,92,246,0.12)' : 'rgba(155,92,246,0.06)' }}
                    transition={{ backgroundColor: { duration: 0.1 } }}
                  >
                    <td>
                      <span className="cell-name">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          style={{ accentColor: 'var(--accent)', marginRight: 6, cursor: 'pointer', flexShrink: 0 }}
                          onChange={() => {}}
                          onClick={e => {
                            e.stopPropagation();
                            setSelectedFolders(prev => {
                              const next = new Set(prev);
                              if (next.has(f.prefix)) next.delete(f.prefix); else next.add(f.prefix);
                              return next;
                            });
                          }}
                        />
                        <motion.span
                          className="icon folder"
                          animate={{ rotate: dragOverFolder === f.prefix ? [0, -10, 10, 0] : 0, scale: dragOverFolder === f.prefix ? 1.2 : 1 }}
                          transition={{ duration: 0.4 }}
                          style={{ display: 'inline-flex', alignItems: 'center' }}
                        ><FolderIcon size={14} /></motion.span>
                        {basename(f.prefix)}
                        {dragOverFolder === f.prefix && <span className="drag-drop-hint"> — drop here</span>}
                      </span>
                    </td>
                    <td className="cell-size">
                      {f.size > 0 ? <>{formatBytes(f.size)}{f.capped && <span style={{ color: 'var(--text-faint)', fontSize: 9 }}>+</span>}</> : '—'}
                    </td>
                    <td className="cell-modified">{hasDate ? formatDate(f.lastModified) : '—'}</td>
                    <td>—</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                        <motion.button
                          className="icon-btn"
                          title="Download as ZIP"
                          whileHover={{ scale: 1.12 }}
                          whileTap={{ scale: 0.88 }}
                          onClick={() => downloadFoldersAction([f.prefix])}
                        >↓ zip</motion.button>
                        <motion.button
                          className="icon-btn danger"
                          title="Delete folder"
                          whileHover={{ scale: 1.2, color: '#ff5d5d' }}
                          whileTap={{ scale: 0.85 }}
                          onClick={() => deleteFolderAction(f.prefix)}
                        >×</motion.button>
                      </div>
                    </td>
                  </motion.tr>
                  );
                })}

                {rows.map((f, idx) => {
                  const info = tierInfo(String(f.storageClass));
                  const isArchived = !info.instantRetrieve;
                  const isDragging = draggedKey === f.key;
                  return (
                    <motion.tr
                      key={f.key}
                      custom={folders.length + idx}
                      variants={rowVariants}
                      initial="hidden"
                      animate="visible"
                      draggable
                      onDragStart={e => {
                        draggedKeyRef.current = f.key;
                        setDraggedKey(f.key);
                        const de = e as unknown as React.DragEvent;
                        de.dataTransfer.effectAllowed = 'move';
                        de.dataTransfer.setData('text/plain', f.key);
                      }}
                      onDragEnd={() => { draggedKeyRef.current = null; setDraggedKey(null); setDragOverFolder(null); }}
                      onClick={() => openFile(f)}
                      className={isDragging ? 'row-dragging' : ''}
                      whileHover={{ backgroundColor: 'rgba(155,92,246,0.06)' }}
                      transition={{ backgroundColor: { duration: 0.1 } }}
                    >
                      <td>
                        <span className="cell-name">
                          <input
                            type="checkbox"
                            checked={selectedFiles.has(f.key)}
                            style={{ accentColor: 'var(--accent)', marginRight: 4, cursor: 'pointer', flexShrink: 0 }}
                            onChange={() => {}}
                            onClick={e => {
                              e.stopPropagation();
                              setSelectedFiles(prev => {
                                const next = new Set(prev);
                                if (next.has(f.key)) next.delete(f.key); else next.add(f.key);
                                return next;
                              });
                            }}
                          />
                          <span className="icon drag-handle" title="Drag to move">&#8942;</span>
                          {showingSearch ? f.key : basename(f.key)}
                        </span>
                      </td>
                      <td className="cell-size">{formatBytes(f.size)}</td>
                      <td className="cell-modified">{formatDate(f.lastModified)}</td>
                      <td>
                        <span className="tier-chip" data-tier={info.costTier} title={info.retrievalTime}>{info.label}</span>
                        {isArchived && <span className="retrieval-badge" title={`Retrieval: ${info.retrievalTime}`}>⏱ {info.retrievalTime}</span>}
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          {isArchived
                            ? <motion.button className="icon-btn" whileHover={{ scale: 1.12 }} whileTap={{ scale: 0.88 }} onClick={() => setRestoreTarget({ key: f.key, storageClass: f.storageClass })}>retrieve</motion.button>
                            : <motion.button className="icon-btn" whileHover={{ scale: 1.12 }} whileTap={{ scale: 0.88 }} onClick={() => downloadFile(f.key)}>↓</motion.button>
                          }
                          <motion.button className="icon-btn" whileHover={{ scale: 1.12 }} whileTap={{ scale: 0.88 }} onClick={() => setShareKey(f.key)}>share</motion.button>
                          <motion.button className="icon-btn" whileHover={{ scale: 1.12 }} whileTap={{ scale: 0.88 }} onClick={() => setVersionsKey(f.key)}>ver</motion.button>
                          <motion.button className="icon-btn danger" whileHover={{ scale: 1.2, color: '#ff5d5d' }} whileTap={{ scale: 0.85 }} onClick={() => deleteFile(f.key)}>×</motion.button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {/* Multi-file action bar */}
          <AnimatePresence>
            {selectedFiles.size > 0 && (
              <motion.div
                style={{
                  position: 'absolute', bottom: selectedFolders.size > 0 ? 76 : 16, left: '50%', zIndex: 10,
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'var(--bg-elev)',
                  border: '1px solid rgba(96,165,250,0.4)',
                  borderRadius: 10,
                  padding: '10px 18px',
                  boxShadow: '0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(96,165,250,0.12)',
                  backdropFilter: 'blur(12px)',
                }}
                initial={{ y: 40, opacity: 0, x: '-50%' }}
                animate={{ y: 0, opacity: 1, x: '-50%' }}
                exit={{ y: 40, opacity: 0, x: '-50%' }}
                transition={{ type: 'spring', damping: 24, stiffness: 320 }}
              >
                <motion.span
                  style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}
                  animate={{ opacity: [0.7, 1, 0.7] }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  {selectedFiles.size} file{selectedFiles.size !== 1 ? 's' : ''} selected
                </motion.span>
                <motion.button
                  className="btn primary"
                  style={{ padding: '5px 14px', fontSize: 12 }}
                  onClick={() => setShowChangeTier(true)}
                  whileHover={{ scale: 1.04, boxShadow: '0 0 14px rgba(96,165,250,0.5)' }}
                  whileTap={{ scale: 0.96 }}
                >
                  ⇄ Change tier
                </motion.button>
                <motion.button
                  className="icon-btn"
                  onClick={() => setSelectedFiles(new Set())}
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: 0.85 }}
                  title="Clear selection"
                >✕</motion.button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Multi-folder action bar */}
          <AnimatePresence>
            {selectedFolders.size > 0 && (
              <motion.div
                style={{
                  position: 'absolute', bottom: 16, left: '50%', zIndex: 10,
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'var(--bg-elev)',
                  border: '1px solid rgba(155,92,246,0.4)',
                  borderRadius: 10,
                  padding: '10px 18px',
                  boxShadow: '0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(155,92,246,0.15)',
                  backdropFilter: 'blur(12px)',
                }}
                initial={{ y: 40, opacity: 0, x: '-50%' }}
                animate={{ y: 0, opacity: 1, x: '-50%' }}
                exit={{ y: 40, opacity: 0, x: '-50%' }}
                transition={{ type: 'spring', damping: 24, stiffness: 320 }}
              >
                <motion.span
                  style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}
                  animate={{ opacity: [0.7, 1, 0.7] }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  {selectedFolders.size} folder{selectedFolders.size !== 1 ? 's' : ''} selected
                </motion.span>
                <motion.button
                  className="btn primary"
                  style={{ padding: '5px 14px', fontSize: 12 }}
                  onClick={() => downloadFoldersAction(Array.from(selectedFolders))}
                  whileHover={{ scale: 1.04, boxShadow: '0 0 14px rgba(155,92,246,0.5)' }}
                  whileTap={{ scale: 0.96 }}
                >
                  ↓ Download {selectedFolders.size > 1 ? `${selectedFolders.size} folders` : ''} as ZIP
                </motion.button>
                <motion.button
                  className="btn"
                  style={{ padding: '5px 14px', fontSize: 12, color: 'var(--danger)' }}
                  onClick={async () => {
                    for (const f of Array.from(selectedFolders)) await deleteFolderAction(f);
                  }}
                  whileHover={{ scale: 1.04, boxShadow: '0 0 14px rgba(255,80,80,0.3)' }}
                  whileTap={{ scale: 0.96 }}
                >
                  × Delete all
                </motion.button>
                <motion.button
                  className="icon-btn"
                  onClick={() => setSelectedFolders(new Set())}
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: 0.85 }}
                  title="Clear selection"
                >
                  ✕
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* Status bar */}
      <div className="statusbar">
        {/* Left: connection */}
        <span className="statusbar-left">
          <motion.span
            className={`statusbar-dot ${config ? '' : 'disconnected'}`}
            animate={config ? { opacity: [1, 0.3, 1], scale: [1, 1.5, 1] } : {}}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          />
          {config ? `${config.bucket} · ${config.region}` : 'Not connected'}
        </span>

        {/* Centre: file info */}
        <span className="statusbar-center">
          {loading ? (
            <motion.span
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1, repeat: Infinity }}
            >Loading…</motion.span>
          ) : showingSearch ? (
            `${rows.length} result${rows.length !== 1 ? 's' : ''}`
          ) : storageClassFilter ? (
            `${rows.length} of ${files.length} · ${STORAGE_CLASSES.find(c => c.id === storageClassFilter)?.label}`
          ) : (
            `${folders.length} folder${folders.length !== 1 ? 's' : ''} · ${files.length} file${files.length !== 1 ? 's' : ''}`
          )}
        </span>

        {/* Right: transfer activity + view mode + clock */}
        <span className="statusbar-right">
          {/* AWS health status badge */}
          <motion.button
            className="statusbar-aws-btn"
            onClick={() => setShowAWSStatus(true)}
            title="AWS Service Health"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.92 }}
          >
            <motion.span
              className="statusbar-aws-dot"
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
            />
            AWS
          </motion.button>
          {(uploadJobs.length > 0 || downloadJobs.length > 0) && (
            <motion.span
              className="statusbar-transfer"
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 1.4, repeat: Infinity }}
            >
              <motion.span
                className="statusbar-transfer-dot"
                animate={{ scale: [1, 1.6, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
              />
              {uploadJobs.filter(j => !j.done).length + downloadJobs.filter(j => !j.done).length} active
            </motion.span>
          )}
          <span className="statusbar-view-badge">{viewMode}</span>
          {bucketBytes !== null && (
            <motion.span
              className="statusbar-storage"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
            >
              {formatBytes(bucketBytes)}
            </motion.span>
          )}
          <motion.span
            className="statusbar-clock"
            key={clock}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {clock}
          </motion.span>
        </span>
      </div>

      <AnimatePresence>
        {(uploadJobs.length > 0 || downloadJobs.length > 0) && (
          <motion.div
            key="transfer-panel"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            style={{ position: 'fixed', bottom: 0, right: 24, zIndex: 90, minWidth: 340 }}
          >
            <UploadPanel
              jobs={[...uploadJobs, ...downloadJobs]}
              onDismiss={() => { setUploadJobs([]); setDownloadJobs([]); }}
              onCancel={cancelUpload}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSettings && (
          <motion.div key="settings" className="modal-anim-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <SettingsModal
              configs={configs} activeIndex={activeIndex}
              onClose={() => setShowSettings(false)}
              onSave={saveConfig}
              onSwitch={async (i) => { await switchBucket(i); setShowSettings(false); }}
              onRemove={removeBucket}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showUpload && config && (
          <motion.div key="upload" className="modal-anim-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <UploadModal prefix={prefix} onClose={() => setShowUpload(false)} onUpload={handleUploadStart} />
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showNewFolder && (
          <motion.div key="newfolder" className="modal-anim-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <NewFolderModal prefix={prefix} onClose={() => setShowNewFolder(false)} onCreate={createFolder} />
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showGDrive && config && (
          <motion.div key="gdrive" className="modal-anim-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <GoogleDriveModal
              prefix={prefix}
              onClose={() => setShowGDrive(false)}
              onTransfer={handleGDriveTransfer}
              onToast={showToast}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {shareKey && (
          <motion.div key="share" className="modal-anim-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <ShareModal objectKey={shareKey} onClose={() => setShareKey(null)} onToast={showToast} />
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {versionsKey && (
          <motion.div key="versions" className="modal-anim-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <VersionsModal objectKey={versionsKey} onClose={() => setVersionsKey(null)} onChanged={refresh} onToast={showToast} />
          </motion.div>
        )}
      </AnimatePresence>
      {previewKey && <PreviewModal objectKey={previewKey} onClose={() => setPreviewKey(null)} onToast={showToast} />}
      <AnimatePresence>
        {showDashboard && <DashboardModal key="dashboard" onClose={() => setShowDashboard(false)} onToast={showToast} />}
      </AnimatePresence>
      <AnimatePresence>
        {showChangeTier && (
          <motion.div key="changetier" className="modal-anim-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <ChangeTierModal
              fileCount={selectedFiles.size}
              onClose={() => setShowChangeTier(false)}
              onConfirm={bulkChangeTier}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showAWSStatus && (
          <motion.div key="awsstatus" className="modal-anim-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <AWSStatusModal onClose={() => setShowAWSStatus(false)} />
          </motion.div>
        )}
      </AnimatePresence>
      {restoreTarget && (
        <RestoreModal
          objectKey={restoreTarget.key}
          storageClass={restoreTarget.storageClass}
          onClose={() => setRestoreTarget(null)}
          onToast={showToast}
          onDownload={async () => {
            setRestoreTarget(null);
            const res = await window.s3drive.s3.download({ key: restoreTarget.key });
            if (!res.ok) showToast(res.error, 'error');
            else if (res.value) showToast(`Saved to ${res.value}`, 'success');
          }}
        />
      )}

      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.msg + toast.kind}
            className={`toast ${toast.kind}`}
            initial={{ x: 80, opacity: 0, scale: 0.92 }}
            animate={{ x: 0, opacity: 1, scale: 1 }}
            exit={{ x: 80, opacity: 0, scale: 0.92 }}
            transition={{ type: 'spring', damping: 22, stiffness: 300 }}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
