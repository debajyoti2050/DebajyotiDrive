import React, { useEffect, useRef, useState } from 'react';
import type { AppConfig } from '@shared/types';

const COMMON_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-central-1',
  'ap-south-1', 'ap-south-2',
  'ap-southeast-1', 'ap-southeast-2',
  'ap-northeast-1', 'ap-northeast-2',
  'ca-central-1', 'sa-east-1', 'me-south-1', 'af-south-1'
];

interface Props {
  configs: AppConfig[];
  activeIndex: number;
  onClose: () => void;
  onSave: (cfg: AppConfig) => Promise<string | null>;
  onSwitch: (index: number) => Promise<void>;
  onRemove: (index: number) => Promise<void>;
}

export const SettingsModal: React.FC<Props> = ({
  configs, activeIndex, onClose, onSave, onSwitch, onRemove
}) => {
  const [bucket, setBucket] = useState('');
  const [region, setRegion] = useState('');
  const [profile, setProfile] = useState('');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(configs.length === 0);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = window.s3drive?.config?.onConnectLog;
    if (typeof fn !== 'function') return;
    return fn((msg) => setLogs(prev => [...prev, msg]));
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const canSave = bucket.trim().length > 0 && region.trim().length > 0 && !testing;

  const handleSave = async () => {
    if (!canSave) return;
    setError(null);
    setLogs([]);
    setTesting(true);
    try {
      const err = await onSave({ bucket: bucket.trim(), region: region.trim(), profile: profile.trim() || undefined });
      if (err) {
        setError(err);
      } else {
        setBucket(''); setRegion(''); setProfile('');
        setShowForm(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={testing ? undefined : onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 580 }}>
        <div className="modal-header">
          <div className="modal-title">Buckets</div>
          <button className="modal-close" onClick={onClose} disabled={testing}>esc</button>
        </div>

        <div className="modal-body">
          {/* Saved buckets list */}
          {configs.length > 0 && (
            <div className="field">
              <label className="field-label">Saved buckets</label>
              <div className="bucket-list">
                {configs.map((c, i) => (
                  <div key={i} className={`bucket-list-row ${i === activeIndex ? 'active' : ''}`}>
                    <div className="bucket-list-info">
                      <div className="bucket-list-name">
                        {i === activeIndex && <span className="bucket-active-dot" />}
                        <strong>{c.bucket}</strong>
                      </div>
                      <div className="bucket-list-meta">
                        {c.region}{c.profile ? ` · ${c.profile}` : ''}
                      </div>
                    </div>
                    <div className="bucket-list-actions">
                      {i !== activeIndex && (
                        <button
                          className="btn"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          onClick={() => onSwitch(i)}
                        >
                          Switch
                        </button>
                      )}
                      {i === activeIndex && (
                        <span style={{ fontSize: 11, color: 'var(--success)', padding: '4px 10px' }}>Active</span>
                      )}
                      {configs.length > 1 && (
                        <button
                          className="btn danger"
                          style={{ padding: '4px 8px', fontSize: 11 }}
                          onClick={() => onRemove(i)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Toggle add form */}
          {!showForm && (
            <button className="btn" onClick={() => setShowForm(true)} style={{ marginBottom: 4 }}>
              + Add bucket
            </button>
          )}

          {/* Add bucket form */}
          {showForm && (
            <>
              <div style={{ borderTop: configs.length > 0 ? '1px solid var(--line)' : 'none', paddingTop: configs.length > 0 ? 16 : 0 }}>
                <label className="field-label" style={{ marginBottom: 12, display: 'block' }}>
                  {configs.length === 0 ? 'Connect your first bucket' : 'Add bucket'}
                </label>
              </div>

              {error && (
                <div className="settings-error">
                  <span className="settings-error-icon">⚠</span>
                  {error}
                </div>
              )}

              <div className="field">
                <label className="field-label">Bucket name</label>
                <input
                  className="field-input"
                  value={bucket}
                  onChange={e => { setBucket(e.target.value); setError(null); }}
                  placeholder="my-s3-bucket"
                  autoFocus
                  disabled={testing}
                />
              </div>
              <div className="field">
                <label className="field-label">Region</label>
                <input
                  className="field-input"
                  value={region}
                  onChange={e => { setRegion(e.target.value); setError(null); }}
                  list="regions"
                  placeholder="e.g. ap-south-1"
                  disabled={testing}
                />
                <datalist id="regions">
                  {COMMON_REGIONS.map(r => <option key={r} value={r} />)}
                </datalist>
                <div className="field-help">Must match the region your bucket was created in.</div>
              </div>
              <div className="field">
                <label className="field-label">AWS profile (optional)</label>
                <input
                  className="field-input"
                  value={profile}
                  onChange={e => setProfile(e.target.value)}
                  placeholder="default"
                  disabled={testing}
                />
                <div className="field-help">
                  Named profile from <code>~/.aws/credentials</code>, or leave blank for env vars / default chain.
                </div>
              </div>
            </>
          )}
        </div>

        {(testing || logs.length > 0) && (
          <div className="connect-log">
            {logs.map((l, i) => (
              <div key={i} className={l.startsWith('ERROR:') ? 'connect-log-err' : ''}>{l}</div>
            ))}
            {testing && <div className="connect-log-cursor">▋</div>}
            <div ref={logEndRef} />
          </div>
        )}

        <div className="modal-footer">
          {showForm && configs.length > 0 && (
            <button className="btn" onClick={() => { setShowForm(false); setError(null); setLogs([]); }} disabled={testing}>
              Cancel add
            </button>
          )}
          <button className="btn" onClick={onClose} disabled={testing} style={{ marginLeft: 'auto' }}>
            {showForm ? 'Close' : 'Done'}
          </button>
          {showForm && (
            <button className="btn primary" disabled={!canSave} onClick={handleSave}>
              {testing ? 'Connecting…' : 'Save & connect'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
