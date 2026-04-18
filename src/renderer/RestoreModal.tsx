import React, { useEffect, useState } from 'react';
import { basename } from './utils';

interface Props {
  objectKey: string;
  storageClass: string;
  onClose: () => void;
  onToast: (msg: string, kind?: 'info' | 'error' | 'success') => void;
  onDownload: () => void;
}

type Tier = 'Expedited' | 'Standard' | 'Bulk';

const TIERS: { id: Tier; label: string; time: string; note: string }[] = [
  { id: 'Expedited', label: 'Expedited', time: '1–5 min',   note: 'Fastest, highest cost' },
  { id: 'Standard',  label: 'Standard',  time: '3–5 hours', note: 'Balanced cost/speed' },
  { id: 'Bulk',      label: 'Bulk',      time: '5–12 hours', note: 'Cheapest, slowest' },
];
const DEEP_TIERS: { id: Tier; label: string; time: string; note: string }[] = [
  { id: 'Standard', label: 'Standard', time: '12 hours',   note: 'Standard restore' },
  { id: 'Bulk',     label: 'Bulk',     time: 'Up to 48h',  note: 'Cheapest' },
];

export const RestoreModal: React.FC<Props> = ({ objectKey, storageClass, onClose, onToast, onDownload }) => {
  const [status, setStatus] = useState<{ ongoing: boolean; expiry?: string } | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [tier, setTier] = useState<Tier>('Standard');
  const [days, setDays] = useState(7);
  const [restoring, setRestoring] = useState(false);

  const isDeep = storageClass === 'DEEP_ARCHIVE';
  const tiers = isDeep ? DEEP_TIERS : TIERS;
  const filename = basename(objectKey);

  useEffect(() => {
    (async () => {
      const res = await window.s3drive.s3.checkRestoreStatus({ key: objectKey });
      setLoadingStatus(false);
      if (res.ok) setStatus(res.value);
    })();
  }, [objectKey]);

  const handleRestore = async () => {
    setRestoring(true);
    const res = await window.s3drive.s3.initiateGlacierRestore({
      key: objectKey,
      days,
      tier,
    });
    setRestoring(false);
    if (!res.ok) { onToast(res.error, 'error'); return; }
    onToast(`Restore initiated for "${filename}". Check back in ${tiers.find(t => t.id === tier)?.time}.`, 'success');
    onClose();
  };

  const isReady = status && !status.ongoing && status.expiry;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 500 }}>
        <div className="modal-header">
          <div className="modal-title">Retrieve from archive</div>
          <button className="modal-close" onClick={onClose}>esc</button>
        </div>

        <div className="modal-body">
          <div style={{ marginBottom: 16, fontSize: 12, color: 'var(--text-dim)' }}>
            <span className="tier-chip" data-tier={isDeep ? 5 : 4} style={{ padding: '0 6px', marginRight: 8 }}>
              {isDeep ? 'Deep Archive' : 'Glacier'}
            </span>
            {filename}
          </div>

          {loadingStatus ? (
            <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>Checking restore status…</div>
          ) : isReady ? (
            <div className="restore-ready">
              <div className="restore-ready-icon">✓</div>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--success)' }}>File is ready to download</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                  Available until {new Date(status!.expiry!).toLocaleDateString()}
                </div>
              </div>
            </div>
          ) : status?.ongoing ? (
            <div className="restore-pending">
              <div style={{ color: 'var(--accent)' }}>⏱ Restore in progress</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                Check back later. The file will be available for download once ready.
              </div>
            </div>
          ) : (
            <>
              <div className="field">
                <label className="field-label">Retrieval speed</label>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  {tiers.map(t => (
                    <div
                      key={t.id}
                      className={`restore-tier-option ${tier === t.id ? 'selected' : ''}`}
                      onClick={() => setTier(t.id)}
                    >
                      <div style={{ fontWeight: 600 }}>{t.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{t.time}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>{t.note}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="field">
                <label className="field-label">Keep available for (days)</label>
                <input
                  className="field-input"
                  type="number"
                  min={1}
                  max={30}
                  value={days}
                  onChange={e => setDays(Math.max(1, Math.min(30, Number(e.target.value))))}
                  style={{ width: 100 }}
                />
                <div className="field-help">1–30 days. You are billed for the entire period.</div>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          {isReady ? (
            <button className="btn primary" onClick={onDownload}>Download now</button>
          ) : !status?.ongoing && !loadingStatus && (
            <button className="btn primary" disabled={restoring} onClick={handleRestore}>
              {restoring ? 'Initiating…' : 'Initiate restore'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
