import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppConfig, S3Object, StorageClass, UploadProgress } from '@shared/types';
import { STORAGE_CLASSES } from '@shared/types';
import { basename, canPreviewInline, formatBytes, formatDate, tierInfo } from './utils';
import { SettingsModal } from './SettingsModal';
import { UploadModal } from './UploadModal';
import { UploadPanel, UploadJob } from './UploadPanel';
import { ShareModal } from './ShareModal';
import { VersionsModal } from './VersionsModal';
import { PreviewModal } from './PreviewModal';
import { DashboardModal } from './DashboardModal';
import { RestoreModal } from './RestoreModal';
import { NewFolderModal } from './NewFolderModal';

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

  const [folders, setFolders] = useState<string[]>([]);
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
  const [shareKey, setShareKey] = useState<string | null>(null);
  const [versionsKey, setVersionsKey] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<{ key: string; storageClass: string } | null>(null);

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
        if (j.key !== p.key) return j;
        const elapsed = Math.max((now - j.startTime) / 1000, 0.1);
        return { ...j, loaded: p.loaded, total: p.total || j.total, done: p.done, error: p.error, speed: p.loaded / elapsed };
      }));
    });
    return off;
  }, []);

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

  const handleUploadStart = (picked: { localPath: string; name: string }[], sc: StorageClass) => {
    setShowUpload(false);
    const jobs: UploadJob[] = picked.map((f, i) => ({
      id: `${Date.now()}-${i}`,
      name: f.name,
      key: `${prefix}${f.name}`,
      localPath: f.localPath,
      loaded: 0, total: 0, done: false,
      startTime: Date.now(), speed: 0, type: 'upload' as const,
    }));
    setUploadJobs(jobs);
    (async () => {
      for (const job of jobs) {
        await window.s3drive.s3.upload({ localPath: job.localPath, key: job.key, storageClass: sc });
      }
      refresh();
    })();
  };

  const cancelUpload = async (jobId: string) => {
    const job = uploadJobsRef.current.find(j => j.id === jobId);
    if (!job) return;
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
        <div className="titlebar-brand">
          Debajyoti<span className="accent">.</span>Drive
        </div>
        <div className="titlebar-actions">
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
          <button className="btn" onClick={() => setShowSettings(true)}>Settings</button>
        </div>
      </div>

      {/* Main layout */}
      <div className="main">
        <aside className="sidebar">
          <div className="sidebar-section">
            <button className="sidebar-button primary" onClick={() => setShowUpload(true)} disabled={!config}>
              ↑ Upload files
            </button>
            <button className="sidebar-button" onClick={() => setShowNewFolder(true)} disabled={!config} style={{ marginTop: 6 }}>
              + New folder
            </button>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-label">Search</div>
            <input
              className="search-box"
              placeholder="Find in bucket…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              disabled={!config}
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
            <button className="sidebar-button" onClick={() => setShowDashboard(true)} disabled={!config}>◈ Analytics</button>
            <button className="sidebar-button" onClick={() => navigate('')} disabled={!config}>⌂ Root</button>
            <button className="sidebar-button" onClick={enableVersioning} disabled={!config}>⟲ Enable versioning</button>
          </div>

          <div className="sidebar-section" style={{ marginTop: 'auto' }}>
            <div className="sidebar-label">Storage tiers</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.7 }}>
              {STORAGE_CLASSES.map(sc => (
                <div key={sc.id}>
                  <span className="tier-chip" data-tier={sc.costTier} style={{ padding: '0 4px' }}>{sc.label}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main
          className={`content${dropZoneActive ? ' drop-zone-active' : ''}`}
          onDragOver={e => { e.preventDefault(); if (!draggedKey) setDropZoneActive(true); }}
          onDragLeave={e => {
            // Only clear if leaving the main element itself
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropZoneActive(false);
          }}
          onDrop={handleContentDrop}
        >
          {/* Storage analytics bar */}
          {storageBar && (
            <div className="storage-bar">
              <div className="storage-bar-info">
                <span>{storageBar.folderCount} folder{storageBar.folderCount !== 1 ? 's' : ''}</span>
                <span className="storage-bar-sep">·</span>
                <span>{storageBar.fileCount} file{storageBar.fileCount !== 1 ? 's' : ''}</span>
                <span className="storage-bar-sep">·</span>
                <span>{formatBytes(storageBar.total)} used</span>
              </div>
              <div className="storage-bar-track">
                {storageBar.byTier.map(({ sc, pct }) => (
                  <div key={sc.id} className="storage-bar-segment" data-tier={sc.costTier} style={{ width: `${pct}%` }} title={`${sc.label}: ${pct.toFixed(1)}%`} />
                ))}
              </div>
            </div>
          )}

          {/* Navigation bar — breadcrumb + back/forward */}
          <div className="nav-bar">
            <div className="nav-arrows">
              <button
                className="nav-arrow-btn"
                onClick={goBack}
                disabled={!canGoBack || showingSearch}
                title="Go back"
              >
                &#8592;
              </button>
              <button
                className="nav-arrow-btn"
                onClick={goForward}
                disabled={!canGoForward || showingSearch}
                title="Go forward"
              >
                &#8594;
              </button>
            </div>

            <div className="nav-path">
              {showingSearch ? (
                <span className="nav-search-label">
                  Search: <span className="nav-search-query">"{searchQuery}"</span>
                  <span className="nav-search-count"> · {rows.length} result{rows.length !== 1 ? 's' : ''}</span>
                </span>
              ) : (
                breadcrumbs.map((c, i) => (
                  <React.Fragment key={c.prefix}>
                    {i > 0 && <span className="nav-sep">›</span>}
                    <span
                      className={`nav-crumb${i === breadcrumbs.length - 1 ? ' current' : ''}`}
                      onClick={() => navigate(c.prefix)}
                      title={c.prefix || '/'}
                    >
                      {i === 0 ? (
                        <span className="nav-crumb-icon">&#x229E;</span>
                      ) : (
                        <span className="nav-crumb-icon">&#x25B8;</span>
                      )}
                      {c.label}
                    </span>
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
          </div>

          {/* Drop hint overlay */}
          {dropZoneActive && (
            <div className="drop-overlay">
              <div className="drop-overlay-label">Drop files to upload to /{prefix || '(root)'}</div>
            </div>
          )}

          {!config && configLoaded ? (
            <div className="empty">
              <div className="empty-icon">D</div>
              <div className="empty-title">Not connected</div>
              <div className="empty-blurb">Configure your bucket and region to get started.</div>
              <button className="btn primary" style={{ marginTop: 20 }} onClick={() => setShowSettings(true)}>
                Open settings
              </button>
            </div>
          ) : rows.length === 0 && folders.length === 0 && !loading ? (
            <div className="empty">
              <div className="empty-icon">&#8709;</div>
              <div className="empty-title">{showingSearch ? 'No matches' : 'This folder is empty'}</div>
              <div className="empty-blurb">{showingSearch ? 'Try a different search term.' : 'Upload files or drop them here.'}</div>
            </div>
          ) : (
            <table className="table">
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
                {!showingSearch && folders.map(f => (
                  <tr
                    key={f}
                    onClick={() => navigate(f)}
                    onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverFolder(f); }}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverFolder(null); }}
                    onDrop={e => {
                      e.preventDefault(); e.stopPropagation();
                      setDragOverFolder(null);
                      const key = draggedKeyRef.current || e.dataTransfer.getData('text/plain');
                      if (key) { moveFile(key, f); draggedKeyRef.current = null; setDraggedKey(null); }
                    }}
                    className={dragOverFolder === f ? 'drag-target' : ''}
                  >
                    <td>
                      <span className="cell-name">
                        <span className="icon folder">&#10022;</span>
                        {basename(f)}
                        {dragOverFolder === f && <span className="drag-drop-hint"> — drop here</span>}
                      </span>
                    </td>
                    <td className="cell-size">—</td>
                    <td className="cell-modified">—</td>
                    <td>—</td>
                    <td></td>
                  </tr>
                ))}

                {rows.map(f => {
                  const info = tierInfo(String(f.storageClass));
                  const isArchived = !info.instantRetrieve;
                  const isDragging = draggedKey === f.key;
                  return (
                    <tr
                      key={f.key}
                      draggable
                      onDragStart={e => {
                        draggedKeyRef.current = f.key;
                        setDraggedKey(f.key);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', f.key);
                      }}
                      onDragEnd={() => { draggedKeyRef.current = null; setDraggedKey(null); setDragOverFolder(null); }}
                      onClick={() => openFile(f)}
                      className={isDragging ? 'row-dragging' : ''}
                    >
                      <td>
                        <span className="cell-name">
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
                            ? <button className="icon-btn" onClick={() => setRestoreTarget({ key: f.key, storageClass: f.storageClass })}>retrieve</button>
                            : <button className="icon-btn" onClick={() => downloadFile(f.key)}>↓</button>
                          }
                          <button className="icon-btn" onClick={() => setShareKey(f.key)}>share</button>
                          <button className="icon-btn" onClick={() => setVersionsKey(f.key)}>ver</button>
                          <button className="icon-btn danger" onClick={() => deleteFile(f.key)}>×</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </main>
      </div>

      {/* Status bar */}
      <div className="statusbar">
        <span>
          <span className={`statusbar-dot ${config ? '' : 'disconnected'}`} />
          {config ? `Connected · ${config.region}` : 'Not connected'}
        </span>
        <span>
          {loading ? 'Loading…' : showingSearch
            ? `${rows.length} result(s)`
            : storageClassFilter
              ? `${rows.length} of ${files.length} · ${STORAGE_CLASSES.find(c => c.id === storageClassFilter)?.label}`
              : `${folders.length} folder(s) · ${files.length} file(s)`}
        </span>
      </div>

      {(uploadJobs.length > 0 || downloadJobs.length > 0) && (
        <UploadPanel
          jobs={[...uploadJobs, ...downloadJobs]}
          onDismiss={() => { setUploadJobs([]); setDownloadJobs([]); }}
          onCancel={cancelUpload}
        />
      )}

      {showSettings && (
        <SettingsModal
          configs={configs} activeIndex={activeIndex}
          onClose={() => setShowSettings(false)}
          onSave={saveConfig}
          onSwitch={async (i) => { await switchBucket(i); setShowSettings(false); }}
          onRemove={removeBucket}
        />
      )}
      {showUpload && config && <UploadModal prefix={prefix} onClose={() => setShowUpload(false)} onUpload={handleUploadStart} />}
      {showNewFolder && <NewFolderModal prefix={prefix} onClose={() => setShowNewFolder(false)} onCreate={createFolder} />}
      {shareKey && <ShareModal objectKey={shareKey} onClose={() => setShareKey(null)} onToast={showToast} />}
      {versionsKey && <VersionsModal objectKey={versionsKey} onClose={() => setVersionsKey(null)} onChanged={refresh} onToast={showToast} />}
      {previewKey && <PreviewModal objectKey={previewKey} onClose={() => setPreviewKey(null)} onToast={showToast} />}
      {showDashboard && <DashboardModal onClose={() => setShowDashboard(false)} onToast={showToast} />}
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

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
};
