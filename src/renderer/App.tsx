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

type Toast = { msg: string; kind: 'info' | 'error' | 'success' } | null;

export const App: React.FC = () => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);

  const [prefix, setPrefix] = useState('');
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<S3Object[]>([]);
  const [loading, setLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<S3Object[] | null>(null);
  const [storageClassFilter, setStorageClassFilter] = useState('');

  // Modals
  const [showSettings, setShowSettings] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [shareKey, setShareKey] = useState<string | null>(null);
  const [versionsKey, setVersionsKey] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<{ key: string; storageClass: string } | null>(null);

  // Upload jobs (managed here, displayed in floating panel)
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>([]);
  const uploadJobsRef = useRef<UploadJob[]>([]);
  uploadJobsRef.current = uploadJobs;

  const [toast, setToast] = useState<Toast>(null);
  const showToast = useCallback((msg: string, kind: 'info' | 'error' | 'success' = 'info') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Boot: load config
  useEffect(() => {
    (async () => {
      const res = await window.s3drive.config.get();
      setConfigLoaded(true);
      if (res.ok && res.value) setConfig(res.value);
      else setShowSettings(true);
    })();
  }, []);

  // Subscribe to upload progress events for the entire app lifetime
  useEffect(() => {
    const off = window.s3drive.s3.onUploadProgress((p: UploadProgress) => {
      const now = Date.now();
      setUploadJobs(prev => prev.map(j => {
        if (j.key !== p.key) return j;
        const elapsed = Math.max((now - j.startTime) / 1000, 0.1);
        return {
          ...j,
          loaded: p.loaded,
          total: p.total || j.total,
          done: p.done,
          error: p.error,
          speed: p.loaded / elapsed,
        };
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

  useEffect(() => {
    if (searchResults === null) refresh();
  }, [refresh, searchResults]);

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

  const saveConfig = async (cfg: AppConfig): Promise<string | null> => {
    const res = await window.s3drive.config.set(cfg);
    if (!res.ok) return res.error;
    setConfig(cfg);
    setShowSettings(false);
    setPrefix('');
    showToast('Connected to ' + cfg.bucket, 'success');
    return null;
  };

  const navigateToFolder = (fp: string) => {
    setSearchQuery('');
    setSearchResults(null);
    setPrefix(fp);
  };

  const createFolder = async () => {
    const name = prompt('Folder name:');
    if (!name?.trim()) return;
    const safe = name.trim().replace(/[/\\]/g, '');
    if (!safe) return;
    const res = await window.s3drive.s3.createFolder(`${prefix}${safe}`);
    if (!res.ok) { showToast(res.error, 'error'); return; }
    showToast(`Folder "${safe}" created`, 'success');
    refresh();
  };

  // Called by UploadModal when user confirms — closes modal, starts upload in background
  const handleUploadStart = (picked: { localPath: string; name: string }[], sc: StorageClass) => {
    setShowUpload(false);
    const jobs: UploadJob[] = picked.map((f, i) => ({
      id: `${Date.now()}-${i}`,
      name: f.name,
      key: `${prefix}${f.name}`,
      localPath: f.localPath,
      loaded: 0,
      total: 0,
      done: false,
      startTime: Date.now(),
      speed: 0,
    }));
    setUploadJobs(jobs);

    (async () => {
      for (const job of jobs) {
        await window.s3drive.s3.upload({ localPath: job.localPath, key: job.key, storageClass: sc });
      }
      refresh();
    })();
  };

  const downloadFile = async (key: string) => {
    const obj = (searchResults ?? files).find(f => f.key === key);
    if (obj) {
      const info = STORAGE_CLASSES.find(c => c.id === obj.storageClass);
      if (info && !info.instantRetrieve) {
        setRestoreTarget({ key, storageClass: obj.storageClass });
        return;
      }
    }
    const res = await window.s3drive.s3.download({ key });
    if (!res.ok) { showToast(res.error, 'error'); return; }
    if (res.value) showToast(`Saved to ${res.value}`, 'success');
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

  // Storage analytics — computed from current listing, no extra API call
  const storageBar = useMemo(() => {
    if (!files.length) return null;
    const total = files.reduce((s, f) => s + f.size, 0);
    const byTier = STORAGE_CLASSES.map(sc => {
      const bytes = files.filter(f => f.storageClass === sc.id).reduce((s, f) => s + f.size, 0);
      return { sc, bytes, pct: total > 0 ? (bytes / total) * 100 : 0 };
    }).filter(t => t.bytes > 0);
    return { total, byTier, fileCount: files.length, folderCount: folders.length };
  }, [files, folders]);

  return (
    <div className="app">
      {/* Titlebar */}
      <div className="titlebar">
        <div className="titlebar-brand">
          Debajyoti<span className="accent">.</span>Drive
        </div>
        <div className="titlebar-actions">
          {config && (
            <div className="titlebar-bucket">
              <strong>{config.bucket}</strong> · {config.region}
              {config.profile && ` · ${config.profile}`}
            </div>
          )}
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
            <button className="sidebar-button" onClick={createFolder} disabled={!config} style={{ marginTop: 6 }}>
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
            <button className="sidebar-button" onClick={() => navigateToFolder('')} disabled={!config}>⌂ Root</button>
            <button className="sidebar-button" onClick={enableVersioning} disabled={!config}>⟲ Enable versioning</button>
          </div>

          <div className="sidebar-section" style={{ marginTop: 'auto' }}>
            <div className="sidebar-label">Storage tiers</div>
            <div style={{ fontSize: 10, color: 'var(--text-faint)', lineHeight: 1.7 }}>
              {STORAGE_CLASSES.map(sc => (
                <div key={sc.id}>
                  <span className="tier-chip" data-tier={sc.costTier} style={{ padding: '0 4px' }}>{sc.label}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="content">
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
                  <div
                    key={sc.id}
                    className="storage-bar-segment"
                    data-tier={sc.costTier}
                    style={{ width: `${pct}%` }}
                    title={`${sc.label}: ${pct.toFixed(1)}%`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Breadcrumb */}
          <div className="breadcrumb">
            {showingSearch ? (
              <>
                <span>Search results for</span>
                <code style={{ color: 'var(--accent)' }}>"{searchQuery}"</code>
                <span style={{ color: 'var(--text-faint)' }}>· {rows.length} match(es)</span>
              </>
            ) : (
              breadcrumbs.map((c, i) => (
                <React.Fragment key={c.prefix}>
                  {i > 0 && <span className="breadcrumb-sep">/</span>}
                  <span className="breadcrumb-item" onClick={() => navigateToFolder(c.prefix)}>{c.label}</span>
                </React.Fragment>
              ))
            )}
          </div>

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
              <div className="empty-icon">∅</div>
              <div className="empty-title">{showingSearch ? 'No matches' : 'This folder is empty'}</div>
              <div className="empty-blurb">{showingSearch ? 'Try a different search term.' : 'Upload files or create a folder.'}</div>
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
                  <tr key={f} onClick={() => navigateToFolder(f)}>
                    <td><span className="cell-name"><span className="icon folder">❧</span>{basename(f)}</span></td>
                    <td className="cell-size">—</td>
                    <td className="cell-modified">—</td>
                    <td>—</td>
                    <td></td>
                  </tr>
                ))}

                {rows.map(f => {
                  const info = tierInfo(String(f.storageClass));
                  const isArchived = !info.instantRetrieve;
                  return (
                    <tr key={f.key} onClick={() => openFile(f)}>
                      <td>
                        <span className="cell-name">
                          <span className="icon">☐</span>
                          {showingSearch ? f.key : basename(f.key)}
                        </span>
                      </td>
                      <td className="cell-size">{formatBytes(f.size)}</td>
                      <td className="cell-modified">{formatDate(f.lastModified)}</td>
                      <td>
                        <span className="tier-chip" data-tier={info.costTier} title={info.retrievalTime}>
                          {info.label}
                        </span>
                        {isArchived && (
                          <span className="retrieval-badge" title={`Retrieval: ${info.retrievalTime}`}>
                            ⏱ {info.retrievalTime}
                          </span>
                        )}
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

      {/* Floating upload panel */}
      {uploadJobs.length > 0 && (
        <UploadPanel
          jobs={uploadJobs}
          onDismiss={() => setUploadJobs([])}
        />
      )}

      {/* Modals */}
      {showSettings && <SettingsModal initial={config} onClose={() => setShowSettings(false)} onSave={saveConfig} />}
      {showUpload && config && (
        <UploadModal prefix={prefix} onClose={() => setShowUpload(false)} onUpload={handleUploadStart} />
      )}
      {shareKey && <ShareModal objectKey={shareKey} onClose={() => setShareKey(null)} onToast={showToast} />}
      {versionsKey && (
        <VersionsModal objectKey={versionsKey} onClose={() => setVersionsKey(null)} onChanged={refresh} onToast={showToast} />
      )}
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
