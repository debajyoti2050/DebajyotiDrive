import React, { useEffect, useState } from 'react';
import { basename } from './utils';

interface Props {
  objectKey: string;
  onClose: () => void;
  onToast: (msg: string, kind?: 'info' | 'error' | 'success') => void;
}

/**
 * Inline preview: we request a short-lived presigned URL (5 min) and
 * embed it as an <img> or <iframe>. This keeps the bucket private
 * while still letting the renderer fetch the bytes directly from S3.
 */
export const PreviewModal: React.FC<Props> = ({ objectKey, onClose, onToast }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await window.s3drive.s3.presign({ key: objectKey, expiresInSeconds: 300 });
      setLoading(false);
      if (!res.ok) { onToast(res.error, 'error'); onClose(); return; }
      setUrl(res.value);
    })();
  }, [objectKey]);

  const ext = objectKey.split('.').pop()?.toLowerCase() ?? '';
  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
  const isPdf = ext === 'pdf';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 900, maxWidth: '92vw' }}>
        <div className="modal-header">
          <div className="modal-title">{basename(objectKey)}</div>
          <button className="modal-close" onClick={onClose}>esc</button>
        </div>
        <div className="modal-body" style={{ padding: 0, background: 'var(--bg)', minHeight: 400 }}>
          {loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>Loading…</div>}
          {url && isImage && (
            <img
              src={url}
              alt={basename(objectKey)}
              style={{ display: 'block', maxWidth: '100%', maxHeight: '70vh', margin: '0 auto' }}
            />
          )}
          {url && isPdf && (
            <iframe
              src={url}
              title={basename(objectKey)}
              style={{ width: '100%', height: '70vh', border: 'none' }}
            />
          )}
          {url && !isImage && !isPdf && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>
              No inline preview for this file type.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
