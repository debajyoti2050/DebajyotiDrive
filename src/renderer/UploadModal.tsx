import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { STORAGE_CLASSES, StorageClass } from '@shared/types';

interface PickedFile { localPath: string; name: string; }

interface Props {
  prefix: string;
  onClose: () => void;
  onUpload: (files: PickedFile[], storageClass: StorageClass) => void;
}

const MAX_BATCH = 10;

const TIER_COLORS: Record<number, string> = {
  1: '#f472b6', 2: '#a78bfa', 3: '#60a5fa', 4: '#34d399', 5: '#6b7280',
};
const USD_TO_INR = 84;
function fmtINR(usd: number) {
  const inr = usd * USD_TO_INR;
  if (inr === 0) return 'Free';
  if (inr < 1) return `₹${inr.toFixed(2)}`;
  return `₹${inr.toFixed(2)}`;
}

export const UploadModal: React.FC<Props> = ({ prefix, onClose, onUpload }) => {
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [storageClass, setStorageClass] = useState<StorageClass>('STANDARD');
  const [isDragHover, setIsDragHover] = useState(false);

  const pickFiles = async () => {
    const res = await window.s3drive.dialog.pickFiles();
    if (!res.ok) return;
    const picked = res.value.map(p => ({ localPath: p, name: p.split(/[/\\]/).pop() ?? p }));
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.localPath));
      return [...prev, ...picked.filter(p => !existing.has(p.localPath))];
    });
  };

  const pickFolder = async () => {
    const res = await window.s3drive.dialog.pickFolder();
    if (!res.ok || !res.value) return;
    const { folderName, files: folderFiles } = res.value;
    const picked = folderFiles.map(f => ({
      localPath: f.localPath,
      name: `${folderName}/${f.relativePath}`,
    }));
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.localPath));
      return [...prev, ...picked.filter(p => !existing.has(p.localPath))];
    });
  };

  const selectedInfo = STORAGE_CLASSES.find(c => c.id === storageClass)!;
  const tierColor = TIER_COLORS[selectedInfo.costTier];
  const overBatch = files.length > MAX_BATCH;
  const queueBatches = Math.ceil(files.length / MAX_BATCH);

  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="upload-modal"
        initial={{ scale: 0.9, opacity: 0, y: 24 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.93, opacity: 0, y: 10 }}
        transition={{ type: 'spring', damping: 24, stiffness: 260 }}
        onClick={e => e.stopPropagation()}
        style={{ '--tc': tierColor } as React.CSSProperties}
      >
        {/* Circuit grid background */}
        <div className="upload-grid-bg" />

        {/* Animated corner accents */}
        {(['tl','tr','bl','br'] as const).map(corner => (
          <motion.div
            key={corner}
            className={`upload-corner upload-corner-${corner}`}
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut', delay: ['tl','br'].includes(corner) ? 0 : 1.25 }}
            style={{ borderColor: `${tierColor}80` }}
          />
        ))}

        {/* Header */}
        <div className="upload-modal-header">
          <div className="upload-modal-header-left">
            <motion.div
              className="upload-hex-icon"
              animate={{ rotate: [0, 360] }}
              transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
              style={{ color: tierColor }}
            >
              <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                <polygon points="17,2 30,9.5 30,24.5 17,32 4,24.5 4,9.5"
                  stroke="currentColor" strokeWidth="1.5" fill="none" />
                <motion.polyline
                  points="12,19 17,14 22,19"
                  stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                />
                <line x1="17" y1="14" x2="17" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </motion.div>
            <div>
              <div className="upload-modal-title">UPLOAD INTERFACE</div>
              <div className="upload-modal-subtitle">
                <motion.span animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }}>▶</motion.span>
                {' '}TARGET: /{prefix || 'root'}
              </div>
            </div>
          </div>
          <motion.button
            className="upload-close-btn"
            onClick={onClose}
            whileHover={{ rotate: 90, scale: 1.15, borderColor: 'var(--danger)', color: 'var(--danger)' }}
            whileTap={{ scale: 0.85 }}
            transition={{ type: 'spring', stiffness: 400, damping: 12 }}
          >✕</motion.button>
        </div>

        <div className="upload-modal-body">
          {/* ── Left: drop zone + file list ── */}
          <div className="upload-modal-left">
            {/* Drop zone */}
            <motion.div
              className={`upload-dropzone ${isDragHover ? 'dz-hover' : ''} ${files.length > 0 ? 'dz-has' : ''}`}
              onClick={pickFiles}
              onDragOver={e => { e.preventDefault(); setIsDragHover(true); }}
              onDragLeave={() => setIsDragHover(false)}
              onDrop={e => { e.preventDefault(); setIsDragHover(false); pickFiles(); }}
              whileHover={{ borderColor: tierColor }}
              animate={isDragHover ? { scale: 1.015 } : { scale: 1 }}
              style={{ borderColor: files.length > 0 ? `${tierColor}60` : undefined }}
            >
              {/* Pulsing rings */}
              {files.length === 0 && [0, 1, 2].map(i => (
                <motion.div
                  key={i}
                  className="dz-ring"
                  animate={{ scale: [1, 1.8 + i * 0.4, 1], opacity: [0.5, 0, 0.5] }}
                  transition={{ duration: 2.8, delay: i * 0.85, repeat: Infinity, ease: 'easeOut' }}
                  style={{ borderColor: `${tierColor}60` }}
                />
              ))}

              <div className="dz-content">
                <AnimatePresence mode="wait">
                  {files.length > 0 ? (
                    <motion.div
                      key="count"
                      className="dz-count"
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.6, opacity: 0 }}
                      style={{ color: tierColor }}
                    >
                      <motion.span
                        animate={{ textShadow: [`0 0 8px ${tierColor}40`, `0 0 20px ${tierColor}80`, `0 0 8px ${tierColor}40`] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      >{files.length}</motion.span>
                      <span className="dz-count-label">FILE{files.length !== 1 ? 'S' : ''} QUEUED</span>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="prompt"
                      className="dz-prompt"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      <motion.svg
                        width="28" height="28" viewBox="0 0 24 24" fill="none"
                        stroke={tierColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                        animate={{ y: [0, -5, 0] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                      </motion.svg>
                      <span className="dz-label">CLICK TO SELECT FILES</span>
                      <span className="dz-hint">or drag &amp; drop</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>

            {/* Folder upload button */}
            <motion.button
              className="upload-folder-btn"
              onClick={pickFolder}
              style={{ color: 'var(--text-faint)', borderColor: `${tierColor}40` }}
              whileHover={{ borderColor: tierColor, color: tierColor, scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                <line x1="12" y1="11" x2="12" y2="17"/><polyline points="9 14 12 11 15 14"/>
              </svg>
              UPLOAD FOLDER
            </motion.button>

            {/* File list */}
            <AnimatePresence>
              {files.length > 0 && (
                <motion.div
                  className="upload-file-list"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  {/* Add more button */}
                  <motion.button
                    className="upload-add-more"
                    onClick={pickFiles}
                    whileHover={{ borderColor: tierColor, color: tierColor }}
                    style={{ color: 'var(--text-faint)' }}
                  >+ ADD MORE</motion.button>

                  <div className="upload-file-rows">
                    {files.map((f, i) => (
                      <motion.div
                        key={f.localPath}
                        className="upload-file-item"
                        initial={{ opacity: 0, x: -14 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 14, height: 0 }}
                        transition={{ delay: Math.min(i * 0.035, 0.3) }}
                      >
                        {/* Scan line */}
                        <motion.div
                          className="file-scan-line"
                          animate={{ x: ['-100%', '200%'] }}
                          transition={{ duration: 1.8, delay: i * 0.12, repeat: Infinity, repeatDelay: 4 + i * 0.4, ease: 'easeInOut' }}
                        />
                        <span className="file-num" style={{ color: tierColor }}>{String(i + 1).padStart(2, '0')}</span>
                        {i >= MAX_BATCH && (
                          <span className="file-batch-tag">B{Math.floor(i / MAX_BATCH) + 1}</span>
                        )}
                        <span className="file-name-label">{f.name}</span>
                        <motion.button
                          className="file-remove-btn"
                          onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                          whileHover={{ scale: 1.2, color: 'var(--danger)' }}
                          whileTap={{ scale: 0.8 }}
                        >×</motion.button>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Right: storage class selector ── */}
          <div className="upload-modal-right">
            <div className="upload-section-label">STORAGE CLASS</div>
            <div className="upload-tier-list">
              {STORAGE_CLASSES.map((c, i) => {
                const tc = TIER_COLORS[c.costTier];
                const selected = storageClass === c.id;
                return (
                  <motion.div
                    key={c.id}
                    className={`upload-tier-card${selected ? ' utc-selected' : ''}`}
                    onClick={() => setStorageClass(c.id)}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    whileHover={{ x: 2, borderColor: tc }}
                    style={selected ? {
                      borderColor: tc,
                      boxShadow: `0 0 14px ${tc}28, inset 0 0 24px ${tc}0a`,
                    } : {}}
                  >
                    {selected && (
                      <motion.div
                        layoutId="tier-bg"
                        className="utc-bg"
                        style={{ background: `linear-gradient(135deg, ${tc}18, transparent 70%)` }}
                      />
                    )}
                    <div className="utc-dot" style={{ background: tc }} />
                    <div className="utc-info">
                      <div className="utc-name">{c.label}</div>
                      <div className="utc-price" style={{ color: tc }}>
                        {fmtINR(c.storagePerGBMonth)}<span>/GB·mo</span>
                      </div>
                    </div>
                    {!c.instantRetrieve && <span className="utc-archive">ARCHIVE</span>}
                    {selected && (
                      <motion.span
                        className="utc-check"
                        initial={{ scale: 0, rotate: -45 }}
                        animate={{ scale: 1, rotate: 0 }}
                        style={{ color: tc }}
                      >✓</motion.span>
                    )}
                  </motion.div>
                );
              })}
            </div>

            {/* Selected tier detail */}
            <AnimatePresence mode="wait">
              <motion.div
                key={storageClass}
                className="upload-tier-detail"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                style={{ borderColor: `${tierColor}50` }}
              >
                <div className="utd-blurb">{selectedInfo.blurb}</div>
                <div className="utd-meta">
                  <span>⚡ {selectedInfo.retrievalTime}</span>
                  {selectedInfo.minDays > 0 && <span>· Min {selectedInfo.minDays}d</span>}
                  {!selectedInfo.instantRetrieve && <span className="utd-warn">⚠ Restore required</span>}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Footer */}
        <div className="upload-modal-footer">
          {overBatch ? (
            <motion.span
              className="upload-batch-label"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              ⚡ {queueBatches} batches · {MAX_BATCH} concurrent
            </motion.span>
          ) : <span />}

          <motion.button
            className="upload-abort-btn"
            onClick={onClose}
            whileHover={{ scale: 1.03, borderColor: 'var(--danger)', color: 'var(--danger)' }}
            whileTap={{ scale: 0.95 }}
          >ABORT</motion.button>

          <motion.button
            className={`upload-transmit-btn${files.length === 0 ? ' utb-disabled' : ''}`}
            disabled={files.length === 0}
            onClick={() => onUpload(files, storageClass)}
            whileHover={files.length > 0 ? { scale: 1.02 } : {}}
            whileTap={files.length > 0 ? { scale: 0.97 } : {}}
            animate={files.length > 0 ? {
              boxShadow: [`0 0 10px ${tierColor}30`, `0 0 22px ${tierColor}60`, `0 0 10px ${tierColor}30`],
            } : {}}
            transition={{ boxShadow: { duration: 2, repeat: Infinity, ease: 'easeInOut' } }}
            style={files.length > 0 ? {
              background: `linear-gradient(135deg, ${tierColor}ee, ${tierColor}99)`,
            } : {}}
          >
            {files.length > 0 && (
              <span className="utb-dots">
                {[0, 1, 2].map(i => (
                  <motion.span key={i}
                    animate={{ opacity: [0.2, 1, 0.2], scale: [0.7, 1.3, 0.7] }}
                    transition={{ duration: 1, delay: i * 0.28, repeat: Infinity }}
                  />
                ))}
              </span>
            )}
            <span>
              {files.length === 0
                ? 'SELECT FILES TO UPLOAD'
                : `TRANSMIT ${files.length} FILE${files.length !== 1 ? 'S' : ''}`}
            </span>
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
};
