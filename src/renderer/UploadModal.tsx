import React, { useState } from 'react';
import { STORAGE_CLASSES, StorageClass } from '@shared/types';

interface PickedFile { localPath: string; name: string; }

interface Props {
  prefix: string;
  onClose: () => void;
  onUpload: (files: PickedFile[], storageClass: StorageClass) => void;
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 620 }}>
        <div className="modal-header">
          <div className="modal-title">
            Upload to <code style={{ color: 'var(--accent)' }}>/{prefix || '(root)'}</code>
          </div>
          <button className="modal-close" onClick={onClose}>esc</button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label className="field-label">Files</label>
            <button className="btn" onClick={pickFiles}>+ Add files</button>
            {files.length > 0 && (
              <div className="upload-list" style={{ marginTop: 10 }}>
                {files.map((f, i) => (
                  <div key={i} className="upload-item">
                    <div className="upload-item-name">
                      <strong>{f.name}</strong>
                      <button
                        className="icon-btn danger"
                        onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                        style={{ padding: '0 6px' }}
                      >remove</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="field">
            <label className="field-label">Storage class</label>
            <div className="field-help" style={{ marginTop: 0, marginBottom: 8 }}>
              Applied per-upload. Change later via the file menu.
            </div>
            <div className="tier-grid">
              {STORAGE_CLASSES.map(c => (
                <div
                  key={c.id}
                  className={`tier-option ${storageClass === c.id ? 'selected' : ''}`}
                  onClick={() => setStorageClass(c.id)}
                >
                  <div className="tier-radio" />
                  <div>
                    <div className="tier-info-label">
                      <span className="tier-chip" data-tier={c.costTier}>{c.label}</span>
                    </div>
                    <div className="tier-info-blurb">{c.blurb}</div>
                    <div className="tier-info-meta">
                      Retrieve: {c.retrievalTime}{c.minDays > 0 && ` · Min ${c.minDays} days`}
                    </div>
                    {!c.instantRetrieve && <div className="tier-warn">⚠ Requires restore before download</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {(storageClass === 'STANDARD_IA' || storageClass === 'ONEZONE_IA') && files.length > 0 && (
            <div className="field-help" style={{ color: 'var(--accent)' }}>
              Heads up: IA tiers bill a minimum of {selectedInfo.minDays} days per object.
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
            Upload {files.length > 0 ? `${files.length} file${files.length > 1 ? 's' : ''}` : ''}
          </button>
        </div>
      </div>
    </div>
  );
};
