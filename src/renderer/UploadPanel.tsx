import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
  speed: number;
  type?: 'upload' | 'download';
  queued?: boolean;
}

interface Props {
  jobs: UploadJob[];
  onDismiss: () => void;
  onCancel?: (id: string) => void;
}

function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <motion.span
      style={{
        display: 'inline-block', width: 6, height: 6,
        borderRadius: '50%',
        background: active ? 'var(--accent)' : 'var(--success)',
        flexShrink: 0,
      }}
      animate={active ? { scale: [1, 1.7, 1], opacity: [1, 0.4, 1] } : { scale: 1, opacity: 1 }}
      transition={{ duration: 0.9, repeat: active ? Infinity : 0 }}
    />
  );
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
    ? errors > 0 ? `${errors} FAILED` : `${total} COMPLETE`
    : [
        activeUploads.length > 0 && `↑ ${activeUploads.length}`,
        activeDownloads.length > 0 && `↓ ${activeDownloads.length}`,
      ].filter(Boolean).join(' · ') || `${done}/${total}`;

  return (
    <div className="xfer-panel">
      {/* Grid background */}
      <div className="xfer-grid-bg" />

      {/* Header */}
      <div className="xfer-header" onClick={() => setMinimized(m => !m)}>
        <div className="xfer-header-left">
          <StatusDot active={!allDone} />
          <motion.span
            className="xfer-header-label"
            animate={!allDone ? { opacity: [0.7, 1, 0.7] } : { opacity: 1 }}
            transition={{ duration: 1.8, repeat: !allDone ? Infinity : 0 }}
          >
            {headerLabel}
          </motion.span>
        </div>
        <div className="xfer-header-right">
          {!allDone && (
            <motion.span
              className="xfer-pct"
              key={overallPct}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {overallPct}%
            </motion.span>
          )}
          <button className="xfer-chevron-btn" onClick={e => { e.stopPropagation(); setMinimized(m => !m); }}>
            <motion.span
              animate={{ rotate: minimized ? 180 : 0 }}
              transition={{ type: 'spring', damping: 18, stiffness: 300 }}
              style={{ display: 'inline-block', fontSize: 10, lineHeight: 1 }}
            >▲</motion.span>
          </button>
          {allDone && (
            <motion.button
              className="xfer-close-btn"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={e => { e.stopPropagation(); onDismiss(); }}
              whileHover={{ scale: 1.2, color: 'var(--danger)' }}
              whileTap={{ scale: 0.85 }}
              transition={{ type: 'spring', stiffness: 400 }}
            >✕</motion.button>
          )}
        </div>
      </div>

      {/* Overall progress bar */}
      {!allDone && (
        <div className="xfer-overall-track">
          <motion.div
            className="xfer-overall-fill"
            initial={{ width: 0 }}
            animate={{ width: `${overallPct}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          >
            <motion.div
              className="xfer-shimmer"
              animate={{ x: ['-100%', '300%'] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'linear', repeatDelay: 0.8 }}
            />
          </motion.div>
        </div>
      )}

      {/* Job rows */}
      <AnimatePresence initial={false}>
        {!minimized && (
          <motion.div
            className="xfer-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <AnimatePresence>
              {jobs.map(j => {
                const pct = j.total > 0 ? j.loaded / j.total * 100 : 0;
                const eta = !j.done && j.speed > 0 && j.total > 0
                  ? formatEta((j.total - j.loaded) / j.speed) : '';
                const isUpload = j.type !== 'download';
                const canCancel = !j.done && isUpload && onCancel;

                const statusColor = j.error
                  ? 'var(--danger)'
                  : j.done
                    ? 'var(--success)'
                    : j.queued
                      ? 'var(--text-faint)'
                      : 'var(--accent)';

                return (
                  <motion.div
                    key={j.id}
                    className={`xfer-row${j.queued ? ' xfer-queued' : ''}`}
                    initial={{ opacity: 0, x: 20, height: 0 }}
                    animate={{ opacity: j.queued ? 0.5 : 1, x: 0, height: 'auto' }}
                    exit={{ opacity: 0, x: 20, height: 0 }}
                    transition={{ type: 'spring', damping: 22, stiffness: 280 }}
                  >
                    {/* Scan sweep on active rows */}
                    {!j.done && !j.queued && (
                      <motion.div
                        className="xfer-row-sweep"
                        animate={{ x: ['-100%', '300%'] }}
                        transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut', repeatDelay: 2 }}
                      />
                    )}

                    <div className="xfer-row-top">
                      <motion.span
                        className="xfer-row-icon"
                        style={{ color: statusColor }}
                        animate={!j.done && !j.queued ? { rotate: isUpload ? [0, 0] : [0, 0], scale: [1, 1.2, 1] } : {}}
                        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                      >
                        {j.error ? '✗' : j.done ? '✓' : j.queued ? '⏸' : isUpload ? '↑' : '↓'}
                      </motion.span>

                      <span className="xfer-row-name" title={j.name}>{j.name}</span>

                      <span className="xfer-row-meta" style={{ color: statusColor }}>
                        {j.error
                          ? j.error === 'Cancelled' ? 'cancelled' : j.error
                          : j.done
                            ? formatBytes(j.total)
                            : j.queued
                              ? 'queued'
                              : j.speed > 0
                                ? `${formatBytes(j.speed)}/s${eta ? ` · ${eta}` : ''}`
                                : j.total > 0 ? `${Math.round(pct)}%` : '…'
                        }
                      </span>

                      {canCancel && (
                        <motion.button
                          className="xfer-cancel-btn"
                          onClick={() => onCancel(j.id)}
                          whileHover={{ scale: 1.2, color: 'var(--danger)' }}
                          whileTap={{ scale: 0.8 }}
                        >×</motion.button>
                      )}
                    </div>

                    {!j.queued && (
                      <div className="xfer-bar-track">
                        <motion.div
                          className={`xfer-bar-fill ${j.error ? 'err' : j.done ? 'ok' : ''}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${j.error ? 100 : pct}%` }}
                          transition={{ duration: 0.3, ease: 'easeOut' }}
                          style={!j.done && !j.error ? {
                            background: `linear-gradient(90deg, var(--accent) 0%, rgba(196,181,253,0.9) 100%)`,
                            boxShadow: '0 0 8px rgba(155,92,246,0.5)',
                          } : {}}
                        />
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
