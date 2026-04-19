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

function fmtPrice(n: number): string {
  if (n === 0) return 'Free';
  if (n < 0.001) return `$${n.toFixed(5)}`;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

export const UploadModal: React.FC<Props> = ({ prefix, onClose, onUpload }) => {
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [storageClass, setStorageClass] = useState<StorageClass>('STANDARD');

  const pickFiles = async () => {
    const res = await window.s3drive.dialog.pickFiles();
    if (!res.ok) return;
    const picked = res.value.map(p => ({ localPath: p, name: p.split(/[/\\]/).pop() ?? p }));
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.localPath));
      return [...prev, ...picked.filter(p => !existing.has(p.localPath))];
    });
  };

  const selectedInfo = STORAGE_CLASSES.find(c => c.id === storageClass)!;
  const queueBatches = Math.ceil(files.length / MAX_BATCH);
  const overBatch = files.length > MAX_BATCH;

  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
    >
      <motion.div
        className="modal"
        initial={{ scale: 0.96, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 8 }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        onClick={e => e.stopPropagation()}
        style={{ width: 660 }}
      >
        <div className="modal-header">
          <div className="modal-title">
            Upload to <code style={{ color: 'var(--accent)' }}>/{prefix || '(root)'}</code>
          </div>
          <button className="modal-close" onClick={onClose}>esc</button>
        </div>

        <div className="modal-body">
          {/* File queue */}
          <div className="field">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <label className="field-label" style={{ marginBottom: 0 }}>Files</label>
              {files.length > 0 && (
                <span className="upload-queue-badge">
                  {files.length} file{files.length !== 1 ? 's' : ''}
                  {overBatch && ` · ${queueBatches} batches of ${MAX_BATCH}`}
                </span>
              )}
            </div>
            <button className="btn" onClick={pickFiles}>+ Add files</button>
            <AnimatePresence>
              {files.length > 0 && (
                <motion.div
                  className="upload-list"
                  style={{ marginTop: 10, maxHeight: 180, overflowY: 'auto' }}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  {files.map((f, i) => (
                    <motion.div
                      key={f.localPath}
                      className="upload-item"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 8 }}
                      transition={{ delay: Math.min(i * 0.03, 0.2) }}
                    >
                      <div className="upload-item-name">
                        <span style={{ fontSize: 11, color: 'var(--text-faint)', marginRight: 4, minWidth: 22, textAlign: 'right', display: 'inline-block' }}>
                          {i + 1}.
                        </span>
                        <strong style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</strong>
                        {i >= MAX_BATCH && (
                          <span style={{ fontSize: 10, color: 'var(--text-faint)', marginRight: 6 }}>queue {Math.floor(i / MAX_BATCH) + 1}</span>
                        )}
                        <button
                          className="icon-btn danger"
                          onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                          style={{ padding: '0 6px', flexShrink: 0 }}
                        >remove</button>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
            {overBatch && (
              <div className="field-help" style={{ marginTop: 6, color: 'var(--info)' }}>
                ℹ {files.length} files will upload {MAX_BATCH} at a time in {queueBatches} batches.
              </div>
            )}
          </div>

          {/* Storage class with pricing */}
          <div className="field">
            <label className="field-label">Storage class</label>
            <div className="field-help" style={{ marginTop: 0, marginBottom: 8 }}>
              Prices shown are us-east-1 reference rates. Actual cost depends on your bucket region.
            </div>
            <div className="tier-grid">
              {STORAGE_CLASSES.map(c => (
                <div
                  key={c.id}
                  className={`tier-option ${storageClass === c.id ? 'selected' : ''}`}
                  onClick={() => setStorageClass(c.id)}
                >
                  <div className="tier-radio" />
                  <div style={{ minWidth: 0 }}>
                    <div className="tier-info-label">
                      <span className="tier-chip" data-tier={c.costTier}>{c.label}</span>
                    </div>
                    <div className="tier-info-blurb">{c.blurb}</div>
                    <div className="tier-info-meta">
                      Retrieve: {c.retrievalTime}{c.minDays > 0 && ` · Min ${c.minDays} days`}
                    </div>
                    {!c.instantRetrieve && (
                      <div className="tier-warn">⚠ Requires restore before download</div>
                    )}
                  </div>
                  {/* Pricing column */}
                  <div className="tier-pricing">
                    <div className="tier-price-main">{fmtPrice(c.storagePerGBMonth)}<span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-dim)' }}>/GB·mo</span></div>
                    <div className="tier-price-retrieval">
                      {c.retrievalPerGB > 0 ? `${fmtPrice(c.retrievalPerGB)}/GB retrieval` : 'Free retrieval'}
                    </div>
                    <div className="tier-price-sub">{fmtPrice(c.putPer1000)}/1k PUTs</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {(storageClass === 'STANDARD_IA' || storageClass === 'ONEZONE_IA') && files.length > 0 && (
            <div className="field-help" style={{ color: 'var(--accent)' }}>
              ⚠ IA tiers bill a minimum of {selectedInfo.minDays} days per object.
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={files.length === 0}
            onClick={() => onUpload(files, storageClass)}
          >
            {files.length === 0
              ? 'Upload'
              : overBatch
                ? `Queue ${files.length} files (${queueBatches} batches)`
                : `Upload ${files.length} file${files.length > 1 ? 's' : ''}`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};
