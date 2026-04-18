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
  initial: AppConfig | null;
  onClose: () => void;
  onSave: (cfg: AppConfig) => Promise<string | null>;
}

export const SettingsModal: React.FC<Props> = ({ initial, onClose, onSave }) => {
  const [bucket, setBucket] = useState(initial?.bucket ?? '');
  const [region, setRegion] = useState(initial?.region ?? '');
  const [profile, setProfile] = useState(initial?.profile ?? '');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
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
      if (err) setError(err);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={testing ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Configuration</div>
          <button className="modal-close" onClick={onClose} disabled={testing}>esc</button>
        </div>
        <div className="modal-body">
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
              onChange={(e) => { setBucket(e.target.value); setError(null); }}
              placeholder="my-s3-drive-bucket"
              autoFocus
              disabled={testing}
            />
            <div className="field-help">
              Must already exist. Create it in the AWS console first.
            </div>
          </div>
          <div className="field">
            <label className="field-label">Region</label>
            <input
              className="field-input"
              value={region}
              onChange={(e) => { setRegion(e.target.value); setError(null); }}
              list="regions"
              placeholder="e.g. ap-south-2"
              disabled={testing}
            />
            <datalist id="regions">
              {COMMON_REGIONS.map(r => <option key={r} value={r} />)}
            </datalist>
            <div className="field-help">
              Must match the region your bucket was created in.
            </div>
          </div>
          <div className="field">
            <label className="field-label">AWS profile (optional)</label>
            <input
              className="field-input"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              placeholder="default"
              disabled={testing}
            />
            <div className="field-help">
              Named profile from <code>~/.aws/credentials</code>. Leave blank to use
              env vars (<code>AWS_ACCESS_KEY_ID</code> / <code>AWS_SECRET_ACCESS_KEY</code>
              from <code>.env</code>) or the default credential chain.
            </div>
          </div>
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
          <button className="btn" onClick={onClose} disabled={testing}>Cancel</button>
          <button className="btn primary" disabled={!canSave} onClick={handleSave}>
            {testing ? 'Connecting…' : 'Save & connect'}
          </button>
        </div>
      </div>
    </div>
  );
};
