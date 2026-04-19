import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { formatBytes } from './utils';
import type { GDriveFile, StorageClass } from '@shared/types';
import { STORAGE_CLASSES } from '@shared/types';

type Screen = 'setup' | 'connect' | 'browse';

interface Props {
  prefix: string;
  onClose: () => void;
  onTransfer: (jobs: { name: string; key: string }[]) => void;
  onToast: (msg: string, kind?: 'info' | 'error' | 'success') => void;
}

const itemVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: (i: number) => ({
    opacity: 1, x: 0,
    transition: { delay: i * 0.025, duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] as const }
  }),
};

export const GoogleDriveModal: React.FC<Props> = ({ prefix, onClose, onTransfer, onToast }) => {
  const [screen, setScreen] = useState<Screen>('setup');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [storageClass, setStorageClass] = useState<StorageClass>('STANDARD');
  const [files, setFiles] = useState<GDriveFile[]>([]);
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([{ id: 'root', name: 'My Drive' }]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [authPending, setAuthPending] = useState(false);
  const clientIdRef = useRef<HTMLInputElement>(null);

  // Check if already connected on mount
  useEffect(() => {
    window.s3drive.gdrive.status().then(res => {
      if (res.ok && res.value.connected) {
        setScreen('browse');
        loadFiles('root');
      }
    });
  }, []);

  const loadFiles = async (folderId: string) => {
    setLoading(true);
    const res = await window.s3drive.gdrive.list(folderId);
    setLoading(false);
    if (!res.ok) { onToast(res.error, 'error'); return; }
    setFiles(res.value);
    setSelected(new Set());
  };

  const handleSetup = async () => {
    if (!clientId.trim() || !clientSecret.trim()) { onToast('Both Client ID and Secret are required.', 'error'); return; }
    const res = await window.s3drive.gdrive.init({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
    if (!res.ok) { onToast(res.error, 'error'); return; }
    setScreen('connect');
  };

  const handleAuth = async () => {
    setAuthPending(true);
    const res = await window.s3drive.gdrive.auth();
    setAuthPending(false);
    if (!res.ok) { onToast(res.error, 'error'); return; }
    onToast('Connected to Google Drive!', 'success');
    setScreen('browse');
    loadFiles('root');
  };

  const handleDisconnect = async () => {
    await window.s3drive.gdrive.disconnect();
    setScreen('setup');
    setFiles([]);
    setSelected(new Set());
  };

  const openFolder = (file: GDriveFile) => {
    setFolderStack(prev => [...prev, { id: file.id, name: file.name }]);
    loadFiles(file.id);
  };

  const goBack = () => {
    if (folderStack.length <= 1) return;
    const next = folderStack.slice(0, -1);
    setFolderStack(next);
    loadFiles(next[next.length - 1].id);
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const nonFolders = files.filter(f => !f.isFolder).map(f => f.id);
    setSelected(new Set(nonFolders));
  };

  const handleTransfer = async () => {
    const toTransfer = files.filter(f => selected.has(f.id) && !f.isFolder);
    if (!toTransfer.length) { onToast('Select at least one file.', 'error'); return; }

    const res = await window.s3drive.gdrive.transfer({
      files: toTransfer,
      destPrefix: prefix,
      storageClass,
    });

    if (!res.ok) { onToast(res.error, 'error'); return; }

    onTransfer(toTransfer.map(f => ({ name: f.name, key: `${prefix}${f.name}` })));
    onClose();
    onToast(`Transferred ${toTransfer.length} file(s) from Drive`, 'success');
  };

  const selectedCount = files.filter(f => selected.has(f.id) && !f.isFolder).length;
  const currentFolder = folderStack[folderStack.length - 1];

  return (
    <motion.div
      className="modal"
      initial={{ scale: 0.96, opacity: 0, y: 12 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 0.96, opacity: 0, y: 12 }}
      transition={{ type: 'spring', damping: 26, stiffness: 360 }}
      onClick={e => e.stopPropagation()}
    >
      <div className="modal-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <motion.span
            animate={{ rotate: [0, 5, -5, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            style={{ fontSize: 20 }}
          >
            &#x25B7;
          </motion.span>
          Import from Google Drive
        </span>
        <motion.button className="icon-btn" onClick={onClose} whileHover={{ scale: 1.2, rotate: 90 }} whileTap={{ scale: 0.85 }} transition={{ duration: 0.15 }}>×</motion.button>
      </div>

      <div className="modal-body" style={{ minHeight: 340 }}>
        <AnimatePresence mode="wait">
          {screen === 'setup' && (
            <motion.div key="setup" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
                Create a <strong>Google Cloud OAuth 2.0 Client ID</strong> at{' '}
                <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => window.s3drive.shell.openExternal('https://console.cloud.google.com/apis/credentials')}>
                  console.cloud.google.com
                </span>{' '}
                with redirect URI <code style={{ background: 'rgba(155,92,246,0.1)', padding: '1px 5px', borderRadius: 4 }}>http://localhost:9876/callback</code>.
                Enable the <strong>Google Drive API</strong> for the project.
              </p>

              {[
                { label: 'Client ID', value: clientId, set: setClientId, ref: clientIdRef, ph: '123456-abc.apps.googleusercontent.com' },
                { label: 'Client Secret', value: clientSecret, set: setClientSecret, ref: null, ph: 'GOCSPX-…' },
              ].map(({ label, value, set, ref, ph }) => (
                <div key={label} className="form-group">
                  <label className="form-label">{label}</label>
                  <motion.input
                    ref={ref as React.RefObject<HTMLInputElement>}
                    className="form-input"
                    type="password"
                    placeholder={ph}
                    value={value}
                    onChange={e => set(e.target.value)}
                    whileFocus={{ boxShadow: '0 0 0 2px rgba(155,92,246,0.4)' }}
                  />
                </div>
              ))}

              <motion.button
                className="btn primary"
                style={{ width: '100%', marginTop: 8 }}
                onClick={handleSetup}
                disabled={!clientId.trim() || !clientSecret.trim()}
                whileHover={{ scale: 1.02, boxShadow: '0 0 18px rgba(155,92,246,0.4)' }}
                whileTap={{ scale: 0.97 }}
              >
                Continue →
              </motion.button>
            </motion.div>
          )}

          {screen === 'connect' && (
            <motion.div key="connect" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '32px 0' }}>
              <motion.div
                style={{ fontSize: 52 }}
                animate={{ y: [0, -8, 0], opacity: [0.8, 1, 0.8] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
              >
                &#x25B7;
              </motion.div>
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.7 }}>
                Click below to open the Google sign-in page in your browser.<br />
                After granting access, return here automatically.
              </div>
              <motion.button
                className="btn primary"
                style={{ width: 220 }}
                onClick={handleAuth}
                disabled={authPending}
                whileHover={{ scale: 1.04, boxShadow: '0 0 22px rgba(155,92,246,0.5)' }}
                whileTap={{ scale: 0.96 }}
                animate={!authPending ? {
                  boxShadow: [
                    '0 0 8px rgba(155,92,246,0.2)',
                    '0 0 22px rgba(155,92,246,0.55)',
                    '0 0 8px rgba(155,92,246,0.2)',
                  ]
                } : {}}
                transition={{ boxShadow: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } }}
              >
                {authPending ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>↻</motion.span>
                    Waiting for browser…
                  </span>
                ) : '🔗 Connect with Google'}
              </motion.button>
              <button className="icon-btn" style={{ fontSize: 12 }} onClick={() => setScreen('setup')}>← Back</button>
            </motion.div>
          )}

          {screen === 'browse' && (
            <motion.div key="browse" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
              {/* Breadcrumb nav */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: 13 }}>
                {folderStack.map((f, i) => (
                  <React.Fragment key={f.id}>
                    {i > 0 && <span style={{ color: 'var(--text-faint)' }}>›</span>}
                    <motion.span
                      style={{ color: i === folderStack.length - 1 ? 'var(--text)' : 'var(--accent)', cursor: i < folderStack.length - 1 ? 'pointer' : 'default' }}
                      onClick={() => {
                        if (i < folderStack.length - 1) {
                          const next = folderStack.slice(0, i + 1);
                          setFolderStack(next);
                          loadFiles(f.id);
                        }
                      }}
                      whileHover={i < folderStack.length - 1 ? { color: '#c4b5fd' } : {}}
                    >
                      {f.name}
                    </motion.span>
                  </React.Fragment>
                ))}
              </div>

              {/* Toolbar */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                {folderStack.length > 1 && (
                  <motion.button className="icon-btn" onClick={goBack} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>← Back</motion.button>
                )}
                <motion.button className="icon-btn" onClick={selectAll} whileHover={{ scale: 1.05 }} style={{ marginLeft: 'auto' }}>Select all files</motion.button>
                <motion.button className="icon-btn" onClick={() => setSelected(new Set())} whileHover={{ scale: 1.05 }}>Clear</motion.button>
                <motion.button className="icon-btn" onClick={handleDisconnect} whileHover={{ scale: 1.05, color: 'var(--danger)' }}>Disconnect</motion.button>
              </div>

              {/* File list */}
              <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, background: 'rgba(0,0,0,0.15)' }}>
                {loading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
                    <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} style={{ fontSize: 24, color: 'var(--accent)' }}>↻</motion.span>
                  </div>
                ) : files.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>This folder is empty</div>
                ) : (
                  <AnimatePresence>
                    {files.map((f, i) => (
                      <motion.div
                        key={f.id}
                        custom={i}
                        variants={itemVariants}
                        initial="hidden"
                        animate="visible"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '7px 12px',
                          cursor: f.isFolder ? 'pointer' : 'default',
                          borderBottom: '1px solid var(--border)',
                          background: selected.has(f.id) ? 'rgba(155,92,246,0.08)' : 'transparent',
                        }}
                        whileHover={{ background: 'rgba(155,92,246,0.06)' }}
                        onClick={() => f.isFolder ? openFolder(f) : toggleSelect(f.id)}
                      >
                        {!f.isFolder && (
                          <motion.input
                            type="checkbox"
                            checked={selected.has(f.id)}
                            onChange={() => toggleSelect(f.id)}
                            onClick={e => e.stopPropagation()}
                            style={{ accentColor: 'var(--accent)', width: 14, height: 14, flexShrink: 0 }}
                            whileHover={{ scale: 1.15 }}
                          />
                        )}
                        <span style={{ fontSize: 16, flexShrink: 0 }}>{f.isFolder ? '📁' : '📄'}</span>
                        <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                        {!f.isFolder && f.size > 0 && (
                          <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>{formatBytes(f.size)}</span>
                        )}
                        {f.isFolder && <span style={{ fontSize: 11, color: 'var(--accent)', flexShrink: 0 }}>Open →</span>}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
              </div>

              {/* Storage class */}
              <div className="form-group" style={{ marginTop: 14 }}>
                <label className="form-label">Upload as storage class</label>
                <select className="form-input" value={storageClass} onChange={e => setStorageClass(e.target.value as StorageClass)}>
                  {STORAGE_CLASSES.map(sc => (
                    <option key={sc.id} value={sc.id}>{sc.label} — ${sc.storagePerGBMonth}/GB/mo</option>
                  ))}
                </select>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {screen === 'browse' && (
        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <motion.button className="btn" onClick={onClose} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>Cancel</motion.button>
          <motion.button
            className="btn primary"
            onClick={handleTransfer}
            disabled={selectedCount === 0}
            whileHover={selectedCount > 0 ? { scale: 1.03, boxShadow: '0 0 16px rgba(155,92,246,0.45)' } : {}}
            whileTap={{ scale: 0.97 }}
          >
            Transfer {selectedCount > 0 ? `${selectedCount} file${selectedCount !== 1 ? 's' : ''}` : '…'} to S3
          </motion.button>
        </div>
      )}
    </motion.div>
  );
};
