import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { PhotoLibraryItem } from '@shared/types';
import { ImageIcon, VideoIcon } from './Icons';
import { formatBytes } from './utils';

type Props = {
  items: PhotoLibraryItem[];
  initialIndex: number;
  onClose: () => void;
  onDownload: (item: PhotoLibraryItem) => void;
};

export const PhotosViewerModal: React.FC<Props> = ({ items, initialIndex, onClose, onDownload }) => {
  const [index, setIndex] = useState(initialIndex);
  const item = items[index];

  const hasMultiple = items.length > 1;
  const adjacent = useMemo(() => {
    if (!item) return [];
    const start = Math.max(0, index - 4);
    return items.slice(start, Math.min(items.length, start + 9)).map((entry, offset) => ({
      item: entry,
      index: start + offset,
    }));
  }, [index, item, items]);

  const move = (delta: number) => {
    if (!items.length) return;
    setIndex(current => (current + delta + items.length) % items.length);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') move(-1);
      if (event.key === 'ArrowRight') move(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length, onClose]);

  if (!item) return null;

  return (
    <motion.div
      className="photos-viewer-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="photos-viewer"
        initial={{ opacity: 0, scale: 0.96, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ type: 'spring', damping: 26, stiffness: 260 }}
        onClick={event => event.stopPropagation()}
      >
        <div className="photos-viewer-topbar">
          <div className="photos-viewer-meta">
            <span className="photo-type viewer-type">
              {item.type === 'video' ? <VideoIcon size={14} /> : <ImageIcon size={14} />}
            </span>
            <div>
              <strong title={item.fileName}>{item.fileName}</strong>
              <span>{index + 1} of {items.length} · {formatBytes(item.size)}</span>
            </div>
          </div>
          <div className="photos-viewer-actions">
            <button onClick={() => onDownload(item)}>Download</button>
            <button onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="photos-viewer-stage">
          {hasMultiple && (
            <button className="photos-viewer-nav prev" onClick={() => move(-1)} aria-label="Previous media">‹</button>
          )}
          <AnimatePresence mode="wait">
            <motion.div
              key={item.id}
              className="photos-viewer-media-frame"
              initial={{ opacity: 0, x: 28, scale: 0.985 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -28, scale: 0.985 }}
              transition={{ duration: 0.24, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              {item.type === 'video' ? (
                <video className="photos-viewer-media" src={item.url} controls autoPlay playsInline />
              ) : (
                <img className="photos-viewer-media" src={item.url} alt={item.fileName} />
              )}
            </motion.div>
          </AnimatePresence>
          {hasMultiple && (
            <button className="photos-viewer-nav next" onClick={() => move(1)} aria-label="Next media">›</button>
          )}
        </div>

        {hasMultiple && (
          <div className="photos-viewer-filmstrip">
            {adjacent.map(entry => (
              <button
                key={entry.item.id}
                className={`photos-thumb${entry.index === index ? ' active' : ''}`}
                onClick={() => setIndex(entry.index)}
                title={entry.item.fileName}
              >
                {entry.item.type === 'video' ? (
                  <>
                    <video src={entry.item.url} muted preload="metadata" />
                    <span><VideoIcon size={11} /></span>
                  </>
                ) : (
                  <img src={entry.item.url} alt="" loading="lazy" />
                )}
              </button>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};
