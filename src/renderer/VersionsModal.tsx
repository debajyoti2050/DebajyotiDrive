import React, { useEffect, useState } from 'react';
import type { S3ObjectVersion } from '@shared/types';
import { formatBytes, formatDate, tierInfo } from './utils';

interface Props {
  objectKey: string;
  onClose: () => void;
  onChanged: () => void;  // refresh parent after restore/delete
  onToast: (msg: string, kind?: 'info' | 'error' | 'success') => void;
}

type RestoreTier = 'Standard' | 'Bulk' | 'Expedited';

export const VersionsModal: React.FC<Props> = ({ objectKey, onClose, onChanged, onToast }) => {
  const [versions, setVersions] = useState<S3ObjectVersion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [archiveStatus, setArchiveStatus] = useState<{
    ongoing: boolean;
    expiry?: string;
    storageClass?: string;
  } | null>(null);

  const load = async () => {
    const res = await window.s3drive.s3.listVersions(objectKey);
    if (!res.ok) { onToast(res.error, 'error'); return; }
    setVersions(res.value);

    // Also check if the latest version is in Glacier and needs restore
    const latest = res.value.find(v => v.isLatest);
    if (latest && (latest.storageClass === 'GLACIER' || latest.storageClass === 'DEEP_ARCHIVE')) {
      const s = await window.s3drive.s3.checkRestoreStatus({ key: objectKey });
      if (s.ok) setArchiveStatus(s.value);
    } else {
      setArchiveStatus(null);
    }
  };

  useEffect(() => { load(); }, [objectKey]);

  const restoreVersion = async (versionId: string) => {
    if (!confirm('Restore this version? A copy of it will become the current version.')) return;
    setBusy(true);
    const res = await window.s3drive.s3.restoreVersion({ key: objectKey, versionId });
    setBusy(false);
    if (!res.ok) { onToast(res.error, 'error'); return; }
    onToast('Version restored', 'success');
    onChanged();
    load();
  };

  const deleteVersion = async (versionId: string) => {
    if (!confirm('Permanently delete this version? This cannot be undone.')) return;
    setBusy(true);
    const res = await window.s3drive.s3.delete({ key: objectKey, versionId });
    setBusy(false);
    if (!res.ok) { onToast(res.error, 'error'); return; }
    onToast('Version deleted', 'success');
    onChanged();
    load();
  };

  const downloadVersion = async (versionId: string) => {
    const res = await window.s3drive.s3.download({ key: objectKey, versionId });
    if (!res.ok) { onToast(res.error, 'error'); return; }
    if (res.value) onToast(`Saved to ${res.value}`, 'success');
  };

  const initiateGlacierRestore = async (tier: RestoreTier, days: number) => {
    setBusy(true);
    const res = await window.s3drive.s3.initiateGlacierRestore({
      key: objectKey, days, tier
    });
    setBusy(false);
    if (!res.ok) { onToast(res.error, 'error'); return; }
    onToast(`Restore initiated (${tier}). This can take minutes to hours.`, 'info');
    load();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 720 }}>
        <div className="modal-header">
          <div className="modal-title">Version history</div>
          <button className="modal-close" onClick={onClose}>esc</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label className="field-label">File</label>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{objectKey}</div>
          </div>

          {/* Glacier restore panel — only if file is in an archive tier */}
          {archiveStatus && (
            <div className="field">
              <label className="field-label">Archive restore</label>
              {archiveStatus.ongoing ? (
                <div className="field-help" style={{ color: 'var(--info)' }}>
                  ⏳ Restore in progress. Refresh in a few minutes.
                </div>
              ) : archiveStatus.expiry ? (
                <div className="field-help" style={{ color: 'var(--success)' }}>
                  ✓ Temporarily restored. Available until {new Date(archiveStatus.expiry).toLocaleString()}.
                </div>
              ) : (
                <>
                  <div className="field-help">
                    This file is in {archiveStatus.storageClass}. Initiate a restore to download it.
                    The original stays archived; a temporary copy becomes accessible for the chosen days.
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => initiateGlacierRestore('Bulk', 7)}
                    >
                      Bulk (5–12 hr) · cheapest
                    </button>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => initiateGlacierRestore('Standard', 7)}
                    >
                      Standard (3–5 hr)
                    </button>
                    {archiveStatus.storageClass === 'GLACIER' && (
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => initiateGlacierRestore('Expedited', 7)}
                      >
                        Expedited (1–5 min) · priciest
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          <label className="field-label">All versions</label>
          {versions === null ? (
            <div className="field-help">Loading…</div>
          ) : versions.length === 0 ? (
            <div className="field-help">
              No version history found. Enable bucket versioning in Settings first.
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              {versions.map(v => (
                <div key={v.versionId} className={`version-row ${v.isLatest ? 'latest' : ''}`}>
                  <div>
                    <div>
                      {v.isLatest && <span style={{ color: 'var(--accent)', marginRight: 8 }}>CURRENT</span>}
                      {formatDate(v.lastModified)}
                      <span style={{ color: 'var(--text-dim)', marginLeft: 8 }}>
                        · {formatBytes(v.size)}
                      </span>
                      <span className="tier-chip" data-tier={tierInfo(v.storageClass).costTier} style={{ marginLeft: 8 }}>
                        {tierInfo(v.storageClass).label}
                      </span>
                    </div>
                    <div className="version-id">v: {v.versionId}</div>
                  </div>
                  <button
                    className="icon-btn"
                    onClick={() => downloadVersion(v.versionId)}
                    disabled={busy}
                  >
                    download
                  </button>
                  {!v.isLatest && (
                    <button
                      className="icon-btn"
                      onClick={() => restoreVersion(v.versionId)}
                      disabled={busy}
                    >
                      restore
                    </button>
                  )}
                  <button
                    className="icon-btn danger"
                    onClick={() => deleteVersion(v.versionId)}
                    disabled={busy}
                  >
                    delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};
