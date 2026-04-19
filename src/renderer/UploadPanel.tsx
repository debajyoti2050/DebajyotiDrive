import React, { useState } from 'react';
import { formatBytes } from './utils';

export interface UploadJob {
  id: string;
  name: string;
  key: string;
  localPath: string;
  loaded: number;
  total: number;
  done: boolean;
  error?: string;
  startTime: number;
  speed: number; // bytes/sec
  type?: 'upload' | 'download';
  queued?: boolean;  // waiting in queue, not yet started
}

interface Props {
  jobs: UploadJob[];
  onDismiss: () => void;
  onCancel?: (id: string) => void;
}

function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export const UploadPanel: React.FC<Props> = ({ jobs, onDismiss, onCancel }) => {
  const [minimized, setMinimized] = useState(false);

  const total = jobs.length;
  const done = jobs.filter(j => j.done).length;
  const errors = jobs.filter(j => j.error && j.error !== 'Cancelled').length;
  const allDone = done === total;
  const overallPct = total === 0 ? 0
    : Math.round(jobs.reduce((s, j) => s + (j.total > 0 ? j.loaded / j.total : 0), 0) / total * 100);

  const activeUploads = jobs.filter(j => !j.done && j.type !== 'download');
  const activeDownloads = jobs.filter(j => !j.done && j.type === 'download');
  const headerLabel = allDone
    ? errors > 0 ? `${errors} failed` : `${total} complete`
    : [
        activeUploads.length > 0 && `Uploading ${activeUploads.length}`,
        activeDownloads.length > 0 && `Downloading ${activeDownloads.length}`,
      ].filter(Boolean).join(' · ') || `${done}/${total}`;

  return (
    <div className="upload-panel">
      <div className="upload-panel-header" onClick={() => setMinimized(m => !m)}>
        <span className="upload-panel-title">{headerLabel}</span>
        <span className="upload-panel-pct">{allDone ? '' : `${overallPct}%`}</span>
        <div className="upload-panel-controls">
          <button className="icon-btn" onClick={e => { e.stopPropagation(); setMinimized(m => !m); }}>
            {minimized ? '▲' : '▼'}
          </button>
          {allDone && (
            <button className="icon-btn" onClick={e => { e.stopPropagation(); onDismiss(); }}>×</button>
          )}
        </div>
      </div>

      {!minimized && (
        <div className="upload-panel-body">
          {jobs.map(j => {
            const pct = j.total > 0 ? Math.round(j.loaded / j.total * 100) : 0;
            const eta = !j.done && j.speed > 0 && j.total > 0
              ? formatEta((j.total - j.loaded) / j.speed)
              : '';
            const isUpload = j.type !== 'download';
            const canCancel = !j.done && isUpload && onCancel;

            return (
              <div key={j.id} className={`upload-panel-row${j.queued ? ' queued' : ''}`}>
                <div className="upload-panel-row-name">
                  <span className={`upload-panel-icon${j.queued ? ' queued' : ''}`}>
                    {j.error ? '✗' : j.done ? '✓' : j.queued ? '⏸' : isUpload ? '↑' : '↓'}
                  </span>
                  <span className="upload-panel-filename" title={j.name}>{j.name}</span>
                  <span className="upload-panel-meta">
                    {j.error
                      ? <span style={{ color: j.error === 'Cancelled' ? 'var(--text-muted)' : 'var(--danger)' }}>{j.error}</span>
                      : j.done
                        ? <span style={{ color: 'var(--success)' }}>Done · {formatBytes(j.total)}</span>
                        : j.queued
                          ? <span style={{ color: 'var(--text-faint)' }}>Queued</span>
                          : j.speed > 0
                            ? `${formatBytes(j.speed)}/s · ${pct}%${eta ? ` · ${eta} left` : ''}`
                            : j.total > 0 ? `${pct}%` : 'Starting…'}
                  </span>
                  {canCancel && (
                    <button
                      className="upload-cancel-btn"
                      title="Cancel upload"
                      onClick={() => onCancel(j.id)}
                    >×</button>
                  )}
                </div>
                {!j.queued && (
                  <div className="upload-bar" style={{ marginTop: 4 }}>
                    <div
                      className={`upload-bar-fill ${j.error ? 'error' : j.done ? 'done' : ''}`}
                      style={{ width: `${j.error ? 100 : pct}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
