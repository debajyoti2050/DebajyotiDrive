import React, { useState } from 'react';
import { basename } from './utils';

interface Props {
  objectKey: string;
  onClose: () => void;
  onToast: (msg: string, kind?: 'info' | 'error' | 'success') => void;
}

const EXPIRY_OPTIONS = [
  { label: '15 minutes', seconds: 15 * 60 },
  { label: '1 hour',     seconds: 60 * 60 },
  { label: '6 hours',    seconds: 6 * 60 * 60 },
  { label: '24 hours',   seconds: 24 * 60 * 60 },
  { label: '7 days (max)', seconds: 7 * 24 * 60 * 60 }
];

export const ShareModal: React.FC<Props> = ({ objectKey, onClose, onToast }) => {
  const [expiry, setExpiry] = useState(EXPIRY_OPTIONS[1].seconds);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    const res = await window.s3drive.s3.presign({ key: objectKey, expiresInSeconds: expiry });
    setLoading(false);
    if (!res.ok) { onToast(res.error, 'error'); return; }
    setUrl(res.value);
  };

  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    onToast('Link copied', 'success');
  };

  const openInBrowser = async () => {
    if (!url) return;
    await window.s3drive.shell.openExternal(url);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Share link</div>
          <button className="modal-close" onClick={onClose}>esc</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label className="field-label">File</label>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{objectKey}</div>
          </div>

          <div className="field">
            <label className="field-label">Link expires in</label>
            <select
              className="field-input"
              value={expiry}
              onChange={(e) => { setExpiry(Number(e.target.value)); setUrl(null); }}
            >
              {EXPIRY_OPTIONS.map(o => (
                <option key={o.seconds} value={o.seconds}>{o.label}</option>
              ))}
            </select>
            <div className="field-help">
              Anyone with the link can download the file until it expires.
              Pre-signed URLs use your AWS credentials — no public bucket access is granted.
            </div>
          </div>

          {!url && (
            <button className="btn primary" onClick={generate} disabled={loading}>
              {loading ? 'Generating…' : 'Generate link'}
            </button>
          )}

          {url && (
            <>
              <label className="field-label">Share URL</label>
              <div className="share-url">{url}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn primary" onClick={copy}>Copy</button>
                <button className="btn" onClick={openInBrowser}>Open in browser</button>
                <button className="btn" onClick={() => { setUrl(null); }}>Regenerate</button>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
};
