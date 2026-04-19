import React, { useState } from 'react';

interface Props {
  prefix: string;
  onClose: () => void;
  onCreate: (name: string) => void;
}

export const NewFolderModal: React.FC<Props> = ({ prefix, onClose, onCreate }) => {
  const [name, setName] = useState('');

  const handleCreate = () => {
    const safe = name.trim().replace(/[/\\]/g, '');
    if (!safe) return;
    onCreate(safe);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 420 }}>
        <div className="modal-header">
          <div className="modal-title">New folder</div>
          <button className="modal-close" onClick={onClose}>esc</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label className="field-label">Folder name</label>
            <input
              className="field-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="my-folder"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') onClose();
              }}
            />
            <div className="field-help">
              Will be created at: <code>/{prefix}{name.trim() || '…'}/</code>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!name.trim()} onClick={handleCreate}>
            Create folder
          </button>
        </div>
      </div>
    </div>
  );
};
