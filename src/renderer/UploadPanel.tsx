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
}

interface Props {
  jobs: UploadJob[];
  onDismiss: () => void;
}

export const UploadPanel: React.FC<Props> = ({ jobs, onDismiss }) => {
  const [minimized, setMinimized] = useState(false);

  const total = jobs.length;
  const done = jobs.filter(j => j.done).length;
  const errors = jobs.filter(j => j.error).length;
  const allDone = done === total;
  const overallPct = total === 0 ? 0
    : Math.round(jobs.reduce((s, j) => s + (j.total > 0 ? j.loaded / j.total : 0), 0) / total * 100);

  return (
    <div className="upload-panel">
      <div className="upload-panel-header" onClick={() => setMinimized(m => !m)}>
        <span className="upload-panel-title">
          {allDone
            ? errors > 0 ? `${errors} failed` : `${total} uploaded`
            : `Uploading ${done}/${total}`}
        </span>
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
            return (
              <div key={j.id} className="upload-panel-row">
                <div className="upload-panel-row-name">
                  <span className="upload-panel-icon">
                    {j.error ? '✗' : j.done ? '✓' : '↑'}
                  </span>
                  <span className="upload-panel-filename" title={j.name}>{j.name}</span>
                  <span className="upload-panel-meta">
                    {j.error
                      ? <span style={{ color: 'var(--danger)' }}>{j.error}</span>
                      : j.done
                        ? <span style={{ color: 'var(--success)' }}>Done</span>
                        : j.speed > 0
                          ? `${formatBytes(j.speed)}/s · ${pct}%`
                          : `${pct}%`}
                  </span>
                </div>
                <div className="upload-bar" style={{ marginTop: 4 }}>
                  <div
                    className={`upload-bar-fill ${j.error ? 'error' : j.done ? 'done' : ''}`}
                    style={{ width: `${j.error ? 100 : pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
