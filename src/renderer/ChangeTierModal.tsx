import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { STORAGE_CLASSES, StorageClass } from '@shared/types';

interface Props {
  fileCount: number;
  onClose: () => void;
  onConfirm: (sc: StorageClass) => void;
}

const TIER_COLORS: Record<number, string> = {
  1: '#f472b6', 2: '#a78bfa', 3: '#60a5fa', 4: '#34d399', 5: '#6b7280',
};

const USD_TO_INR = 84;
function fmtINR(usd: number) {
  const inr = usd * USD_TO_INR;
  if (inr === 0) return 'Free';
  return `₹${inr.toFixed(2)}`;
}

export const ChangeTierModal: React.FC<Props> = ({ fileCount, onClose, onConfirm }) => {
  const [selected, setSelected] = useState<StorageClass>('STANDARD');
  const info = STORAGE_CLASSES.find(c => c.id === selected)!;
  const tc = TIER_COLORS[info.costTier];

  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="ctm-modal"
        initial={{ scale: 0.88, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 8 }}
        transition={{ type: 'spring', damping: 24, stiffness: 280 }}
        onClick={e => e.stopPropagation()}
        style={{ '--tc': tc } as React.CSSProperties}
      >
        {/* Circuit grid background */}
        <div className="upload-grid-bg" />

        {/* Corner accents */}
        {(['tl', 'tr', 'bl', 'br'] as const).map(corner => (
          <motion.div
            key={corner}
            className={`upload-corner upload-corner-${corner}`}
            animate={{ opacity: [0.3, 0.85, 0.3] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut', delay: ['tl', 'br'].includes(corner) ? 0 : 1.25 }}
            style={{ borderColor: `${tc}60` }}
          />
        ))}

        {/* Header */}
        <div className="ctm-header">
          <motion.div
            className="ctm-icon"
            animate={{ rotate: [0, 360] }}
            transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
            style={{ color: tc }}
          >
            <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
              <polygon points="15,2 27,8.5 27,21.5 15,28 3,21.5 3,8.5"
                stroke="currentColor" strokeWidth="1.5" fill="none" />
              <circle cx="15" cy="15" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <motion.circle cx="15" cy="15" r="7.5"
                stroke="currentColor" strokeWidth="0.8" strokeDasharray="3 3"
                animate={{ rotate: [0, -360] }}
                transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
                style={{ transformOrigin: '15px 15px' }}
              />
            </svg>
          </motion.div>
          <div>
            <div className="ctm-title">CHANGE STORAGE TIER</div>
            <div className="ctm-subtitle">
              <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.8, repeat: Infinity }}>▶</motion.span>
              {' '}{fileCount} FILE{fileCount !== 1 ? 'S' : ''} SELECTED
            </div>
          </div>
          <motion.button
            className="upload-close-btn"
            onClick={onClose}
            whileHover={{ rotate: 90, scale: 1.15, borderColor: 'var(--danger)', color: 'var(--danger)' }}
            whileTap={{ scale: 0.85 }}
            transition={{ type: 'spring', stiffness: 400, damping: 12 }}
          >✕</motion.button>
        </div>

        <div className="ctm-body">
          {/* Tier list */}
          <div className="ctm-tier-list">
            {STORAGE_CLASSES.map((c, i) => {
              const color = TIER_COLORS[c.costTier];
              const sel = selected === c.id;
              return (
                <motion.div
                  key={c.id}
                  className={`ctm-tier-card${sel ? ' ctm-selected' : ''}`}
                  onClick={() => setSelected(c.id)}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  whileHover={{ x: 3, borderColor: color }}
                  style={sel ? { borderColor: color, boxShadow: `0 0 14px ${color}30` } : {}}
                >
                  {sel && (
                    <motion.div
                      layoutId="ctm-tier-bg"
                      className="ctm-tier-bg"
                      style={{ background: `linear-gradient(135deg, ${color}1a, transparent 70%)` }}
                    />
                  )}
                  <div className="ctm-tier-dot" style={{ background: color }} />
                  <div className="ctm-tier-info">
                    <span className="ctm-tier-name">{c.label}</span>
                    <span className="ctm-tier-price" style={{ color }}>
                      {fmtINR(c.storagePerGBMonth)}<span style={{ opacity: 0.6, fontSize: 9 }}>/GB·mo</span>
                    </span>
                  </div>
                  <span className="ctm-tier-retrieval">{c.retrievalTime}</span>
                  {!c.instantRetrieve && <span className="ctm-tier-archive">ARCHIVE</span>}
                  {sel && (
                    <motion.span
                      className="ctm-tier-check"
                      initial={{ scale: 0, rotate: -45 }}
                      animate={{ scale: 1, rotate: 0 }}
                      style={{ color }}
                    >✓</motion.span>
                  )}
                </motion.div>
              );
            })}
          </div>

          {/* Selected tier detail */}
          <AnimatePresence mode="wait">
            <motion.div
              key={selected}
              className="ctm-detail"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              style={{ borderColor: `${tc}45`, background: `${tc}08` }}
            >
              <div className="ctm-detail-blurb">{info.blurb}</div>
              <div className="ctm-detail-meta">
                <span>⚡ {info.retrievalTime}</span>
                {info.minDays > 0 && <span>· Min {info.minDays}d stored</span>}
                {!info.instantRetrieve && (
                  <span style={{ color: 'var(--danger)' }}>⚠ Restore required</span>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="ctm-footer">
          <motion.button
            className="upload-abort-btn"
            onClick={onClose}
            whileHover={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
            whileTap={{ scale: 0.95 }}
          >CANCEL</motion.button>
          <motion.button
            className="ctm-confirm-btn"
            onClick={() => onConfirm(selected)}
            style={{ background: `linear-gradient(135deg, ${tc}ee, ${tc}88)` }}
            whileHover={{ scale: 1.03, boxShadow: `0 0 22px ${tc}55` }}
            whileTap={{ scale: 0.97 }}
            animate={{ boxShadow: [`0 0 8px ${tc}28`, `0 0 20px ${tc}58`, `0 0 8px ${tc}28`] }}
            transition={{ boxShadow: { duration: 2, repeat: Infinity, ease: 'easeInOut' } }}
          >
            <span>APPLY TO {fileCount} FILE{fileCount !== 1 ? 'S' : ''}</span>
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
};
