import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { PhotoLibraryItem, PickedPhotoUploadFile, UploadProgress } from '@shared/types';
import {
  CheckCircleIcon, CircleIcon, CloudUploadIcon, DownloadIcon,
  ImageIcon, LinkIcon, TrashIcon, VideoIcon,
} from './Icons';
import { formatBytes } from './utils';
import { PhotosViewerModal } from './PhotosViewerModal';

type Props = {
  connected: boolean;
  onToast: (message: string, kind?: 'info' | 'error' | 'success') => void;
};

type PhotoUploadJob = PickedPhotoUploadFile & {
  loaded: number;
  total: number;
  done: boolean;
  error?: string;
};

function monthLabel(date: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(date));
}

function isFresh(item: PhotoLibraryItem) {
  return Date.now() - new Date(item.createdAt).getTime() < 1000 * 60 * 60 * 24 * 7;
}

function mergePicked(existing: PhotoUploadJob[], picked: PickedPhotoUploadFile[]): PhotoUploadJob[] {
  const seen = new Set(existing.map(item => item.id));
  return [
    ...existing,
    ...picked
      .filter(item => !seen.has(item.id))
      .map(item => ({ ...item, loaded: 0, total: 0, done: false })),
  ];
}

export const PhotosLibraryView: React.FC<Props> = ({ connected, onToast }) => {
  const [items, setItems] = useState<PhotoLibraryItem[]>([]);
  const [prefix, setPrefix] = useState('debajyoti-photos/');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isDropHot, setIsDropHot] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uploadJobs, setUploadJobs] = useState<PhotoUploadJob[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const selCount = selectedIds.size;

  const load = useCallback(async () => {
    if (!connected || !window.s3drive?.photos) return;
    setLoading(true);
    setError(null);
    try {
      const res = await window.s3drive.photos.list();
      if (!res.ok) throw new Error(res.error);
      setItems(res.value.items);
      setPrefix(res.value.prefix);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      onToast(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [connected, onToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onUploadProgress = window.s3drive?.s3?.onUploadProgress;
    if (!onUploadProgress) return;
    return onUploadProgress((progress: UploadProgress) => {
      setUploadJobs(prev => prev.map(job => {
        if (job.key !== progress.key) return job;
        return {
          ...job,
          loaded: progress.loaded,
          total: progress.total || job.total,
          done: progress.done,
          error: progress.error,
        };
      }));
    });
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(item => item.fileName.toLowerCase().includes(needle) || item.key.toLowerCase().includes(needle));
  }, [items, query]);

  const groups = useMemo(() => {
    const grouped = new Map<string, PhotoLibraryItem[]>();
    for (const item of filtered) {
      const label = monthLabel(item.createdAt);
      grouped.set(label, [...(grouped.get(label) || []), item]);
    }
    return Array.from(grouped.entries()).map(([label, data]) => ({ label, data }));
  }, [filtered]);

  const totalBytes = items.reduce((sum, item) => sum + item.size, 0);
  const videoCount = items.filter(item => item.type === 'video').length;
  const freshCount = items.filter(isFresh).length;
  const queuedCount = uploadJobs.filter(job => !job.done).length;
  const uploadedCount = uploadJobs.filter(job => job.done && !job.error).length;
  const uploadTotal = uploadJobs.reduce((sum, job) => sum + (job.total || 0), 0);
  const uploadLoaded = uploadJobs.reduce((sum, job) => sum + Math.min(job.loaded, job.total || job.loaded), 0);
  const uploadPct = uploadTotal > 0 ? Math.round((uploadLoaded / uploadTotal) * 100) : uploadedCount > 0 ? 100 : 0;

  // ── Selection actions ──────────────────────────────────────────────────────

  const toggleSelect = (id: string, index: number, shiftKey: boolean) => {
    if (shiftKey && lastSelectedIndex !== null) {
      const lo = Math.min(lastSelectedIndex, index);
      const hi = Math.max(lastSelectedIndex, index);
      setSelectedIds(prev => {
        const next = new Set(prev);
        filtered.slice(lo, hi + 1).forEach(item => next.add(item.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      setLastSelectedIndex(index);
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setLastSelectedIndex(null);
  };

  const selectAll = () => setSelectedIds(new Set(filtered.map(item => item.id)));

  const deleteSelected = async () => {
    const keys = Array.from(selectedIds);
    if (!keys.length) return;
    setIsDeleting(true);
    let okCount = 0;
    for (const key of keys) {
      const res = await window.s3drive.s3.delete({ key });
      if (res.ok) okCount++;
      else onToast(res.error, 'error');
    }
    setIsDeleting(false);
    clearSelection();
    if (okCount > 0) {
      onToast(`${okCount} item${okCount > 1 ? 's' : ''} deleted`, 'success');
      await load();
    }
  };

  const downloadSelected = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (ids.length === 1) {
      const item = filtered.find(entry => entry.id === ids[0]);
      if (item) await download(item);
    } else {
      const jobKey = `photos-sel-${Date.now()}`;
      const res = await window.s3drive.photos.downloadZip({ keys: ids, jobKey });
      if (!res.ok) onToast(res.error, 'error');
      else if (res.value) onToast(`Saved to ${res.value}`, 'success');
    }
  };

  const copyLink = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length !== 1) return;
    const res = await window.s3drive.s3.presign({ key: ids[0], expiresInSeconds: 86400 });
    if (!res.ok) { onToast(res.error, 'error'); return; }
    await navigator.clipboard.writeText(res.value);
    onToast('Link copied (expires in 24 h)', 'success');
  };

  // ── Upload actions ─────────────────────────────────────────────────────────

  const pickMedia = async () => {
    if (!connected) {
      onToast('Connect a bucket first - open Settings to configure your S3 bucket.', 'info');
      return;
    }
    if (!window.s3drive?.photos?.pickMedia) {
      onToast('Photos upload is available in the Debajyoti Drive desktop app window.', 'error');
      return;
    }
    const res = await window.s3drive.photos.pickMedia();
    if (!res.ok) { onToast(res.error, 'error'); return; }
    if (!res.value.length) return;
    onToast(`${res.value.length} media item${res.value.length === 1 ? '' : 's'} ready to upload`, 'info');
    setUploadJobs(prev => mergePicked(prev.filter(job => !job.done || job.error), res.value));
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDropHot(false);
    if (!connected) {
      onToast('Connect a bucket first - open Settings to configure your S3 bucket.', 'info');
      return;
    }
    if (!window.s3drive?.photos?.registerDroppedMedia) {
      onToast('Photos folder drop is available in the Debajyoti Drive desktop app window.', 'error');
      return;
    }
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) return;
    const res = await window.s3drive.photos.registerDroppedMedia(files);
    if (!res.ok) { onToast(res.error, 'error'); return; }
    if (!res.value.length) {
      onToast('No supported photos or videos found.', 'info');
      return;
    }
    setUploadJobs(prev => mergePicked(prev.filter(job => !job.done || job.error), res.value));
  };

  const startUpload = async () => {
    const pending = uploadJobs.filter(job => !job.done);
    if (!pending.length || !window.s3drive?.photos?.upload) return;
    setUploading(true);
    let okCount = 0;

    for (const job of pending) {
      const res = await window.s3drive.photos.upload({ uploadId: job.id });
      if (res.ok) {
        okCount += 1;
        setUploadJobs(prev => prev.map(item =>
          item.id === job.id ? { ...item, done: true } : item
        ));
      } else {
        setUploadJobs(prev => prev.map(item =>
          item.id === job.id ? { ...item, done: true, error: res.error } : item
        ));
      }
    }

    setUploading(false);
    if (okCount > 0) {
      onToast(`${okCount} media item${okCount === 1 ? '' : 's'} uploaded to Photos`, 'success');
      await load();
    }
  };

  const clearUploads = () => setUploadJobs(prev => prev.filter(job => !job.done && !job.error));

  const download = async (item: PhotoLibraryItem) => {
    const res = await window.s3drive.s3.download({ key: item.key });
    if (!res.ok) onToast(res.error, 'error');
    else if (res.value) onToast(`Saved to ${res.value}`, 'success');
  };

  return (
    <motion.section
      className={`photos-view${isDropHot ? ' photos-drop-hot' : ''}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.25, 0.46, 0.45, 0.94] }}
      onDragOver={event => {
        event.preventDefault();
        event.stopPropagation();
        if (connected) setIsDropHot(true);
      }}
      onDragLeave={event => {
        event.stopPropagation();
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDropHot(false);
      }}
      onDrop={handleDrop}
    >
      <div className="photos-hero">
        <div className="photos-hero-copy">
          <div className="photos-kicker">S3 photo library</div>
          <h2>Debajyoti Photos</h2>
          <p>{connected ? `Reading media from ${prefix}` : 'Connect a bucket to read your photo library.'}</p>
        </div>
        <div className="photos-metrics">
          <motion.div className="photos-metric" whileHover={{ y: -3 }}>
            <span>{items.length}</span>
            <small>items</small>
          </motion.div>
          <motion.div className="photos-metric" whileHover={{ y: -3 }}>
            <span>{formatBytes(totalBytes)}</span>
            <small>stored</small>
          </motion.div>
          <motion.div className="photos-metric" whileHover={{ y: -3 }}>
            <span>{videoCount}</span>
            <small>videos</small>
          </motion.div>
          <motion.div className="photos-metric" whileHover={{ y: -3 }}>
            <span>{freshCount}</span>
            <small>new this week</small>
          </motion.div>
        </div>
      </div>

      <div className="photos-upload-console">
        <div className="photos-upload-zone" onClick={pickMedia}>
          <CloudUploadIcon size={20} />
          <div>
            <strong>{uploadJobs.length ? `${uploadJobs.length} selected` : 'Upload photos and videos'}</strong>
            <span>Media only · Standard tier locked · drag files or folders here</span>
          </div>
          <span className="photos-tier-lock">STANDARD</span>
        </div>
        <div className="photos-upload-actions">
          <motion.button
            className="btn"
            onClick={pickMedia}
            disabled={!connected || uploading}
            whileHover={connected ? { scale: 1.03 } : {}}
            whileTap={connected ? { scale: 0.96 } : {}}
          >
            Add media
          </motion.button>
          <motion.button
            className="btn primary"
            onClick={startUpload}
            disabled={!connected || uploading || queuedCount === 0}
            whileHover={queuedCount > 0 ? { scale: 1.03 } : {}}
            whileTap={queuedCount > 0 ? { scale: 0.96 } : {}}
          >
            {uploading ? `Uploading ${uploadPct}%` : queuedCount ? `Upload ${queuedCount}` : 'Upload'}
          </motion.button>
        </div>
      </div>

      <AnimatePresence>
        {uploadJobs.length > 0 && (
          <motion.div
            className="photos-upload-queue"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div className="photos-upload-queue-head">
              <span>{uploading ? 'Uploading to Photos' : 'Photos upload queue'}</span>
              <button onClick={clearUploads} disabled={uploading}>Clear completed</button>
            </div>
            <div className="photos-upload-progress">
              <motion.div animate={{ width: `${uploadPct}%` }} transition={{ duration: 0.24 }} />
            </div>
            <div className="photos-upload-items">
              {uploadJobs.map(job => {
                const pct = job.total > 0 ? Math.round((job.loaded / job.total) * 100) : job.done && !job.error ? 100 : 0;
                return (
                  <div key={job.id} className={`photos-upload-item${job.error ? ' error' : ''}`}>
                    <span>{job.type === 'video' ? <VideoIcon size={13} /> : <ImageIcon size={13} />}</span>
                    <strong title={job.name}>{job.name}</strong>
                    <small>{job.error ? job.error : job.done ? 'Uploaded' : uploading ? `${pct}%` : 'Ready'}</small>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="photos-toolbar">
        <div className="photos-search">
          <ImageIcon size={16} />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search photos and videos"
          />
        </div>
        <motion.button
          className="btn"
          onClick={load}
          disabled={!connected || loading}
          whileHover={{ scale: connected ? 1.03 : 1 }}
          whileTap={{ scale: connected ? 0.96 : 1 }}
        >
          {loading ? 'Syncing...' : 'Refresh'}
        </motion.button>
      </div>

      {!connected ? (
        <div className="photos-empty">
          <ImageIcon size={34} />
          <strong>Bucket connection required</strong>
          <span>Use Settings to connect your S3 bucket, then this view can upload and read the Photos prefix.</span>
        </div>
      ) : error ? (
        <div className="photos-empty photos-error">
          <strong>Could not load Photos</strong>
          <span>{error}</span>
        </div>
      ) : loading && items.length === 0 ? (
        <div className="photos-empty">
          <motion.span animate={{ opacity: [0.35, 1, 0.35] }} transition={{ duration: 1.1, repeat: Infinity }}>Loading photo library...</motion.span>
        </div>
      ) : groups.length === 0 ? (
        <div className="photos-empty">
          <ImageIcon size={34} />
          <strong>No media found</strong>
          <span>Upload photos or videos here. They will be stored under {prefix} using Standard tier.</span>
        </div>
      ) : (
        <div className="photos-timeline">
          <AnimatePresence>
            {groups.map((group, groupIndex) => (
              <motion.div
                key={group.label}
                className="photos-month"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ delay: groupIndex * 0.04 }}
              >
                <div className="photos-month-title">
                  <span>{group.label}</span>
                  <small>{group.data.length} item{group.data.length !== 1 ? 's' : ''}</small>
                </div>
                <div className="photos-grid">
                  {group.data.map((item, index) => {
                    const flatIndex = filtered.findIndex(entry => entry.id === item.id);
                    const isSelected = selectedIds.has(item.id);
                    return (
                      <motion.article
                        key={item.id}
                        className={`photo-card${index % 9 === 0 ? ' photo-card-large' : ''}${isSelected ? ' photo-card-selected' : ''}`}
                        initial={{ opacity: 0, scale: 0.94 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: Math.min(index, 18) * 0.018, type: 'spring', damping: 24, stiffness: 300 }}
                        whileHover={{ y: selCount > 0 ? 0 : -4, scale: selCount > 0 ? 1 : 1.015 }}
                        onClick={(event) => {
                          if (selCount > 0 || event.shiftKey) {
                            toggleSelect(item.id, flatIndex, event.shiftKey);
                          } else {
                            setViewerIndex(flatIndex);
                          }
                        }}
                      >
                        {item.type === 'video' ? (
                          <video className="photo-media" src={item.url} muted preload="metadata" />
                        ) : (
                          <img className="photo-media" src={item.url} alt={item.fileName} loading="lazy" />
                        )}

                        {/* Checkbox for selection */}
                        <button
                          className={`photo-select-check${isSelected ? ' checked' : ''}`}
                          onClick={event => {
                            event.stopPropagation();
                            toggleSelect(item.id, flatIndex, event.shiftKey);
                          }}
                          aria-label={isSelected ? 'Deselect' : 'Select'}
                        >
                          {isSelected
                            ? <CheckCircleIcon size={18} />
                            : <CircleIcon size={18} />}
                        </button>

                        <div className="photo-overlay">
                          <span className="photo-type">{item.type === 'video' ? <VideoIcon size={13} /> : <ImageIcon size={13} />}</span>
                          {selCount === 0 && (
                            <button onClick={event => { event.stopPropagation(); setViewerIndex(flatIndex); }}>
                              View
                            </button>
                          )}
                        </div>
                        <div className="photo-caption">
                          <strong title={item.fileName}>{item.fileName}</strong>
                          <span>{formatBytes(item.size)}</span>
                        </div>
                      </motion.article>
                    );
                  })}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Floating selection action bar */}
      <AnimatePresence>
        {selCount > 0 && (
          <motion.div
            className="photos-selection-bar"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: 'spring', damping: 22, stiffness: 300 }}
          >
            <span className="photos-sel-count">{selCount} selected</span>
            <button className="photos-sel-action" onClick={selectAll}>
              Select all
            </button>
            <div className="photos-sel-sep" />
            <button className="photos-sel-action" onClick={downloadSelected} title="Download">
              <DownloadIcon size={14} />
              Download
            </button>
            {selCount === 1 && (
              <button className="photos-sel-action" onClick={copyLink} title="Copy shareable link (24 h)">
                <LinkIcon size={14} />
                Copy link
              </button>
            )}
            <button
              className="photos-sel-action danger"
              onClick={deleteSelected}
              disabled={isDeleting}
              title="Delete selected"
            >
              <TrashIcon size={14} />
              {isDeleting ? 'Deleting…' : 'Delete'}
            </button>
            <button className="photos-sel-close" onClick={clearSelection} aria-label="Clear selection">✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewerIndex !== null && (
          <PhotosViewerModal
            items={filtered}
            initialIndex={Math.max(0, viewerIndex)}
            onClose={() => setViewerIndex(null)}
            onDownload={download}
          />
        )}
      </AnimatePresence>
    </motion.section>
  );
};
