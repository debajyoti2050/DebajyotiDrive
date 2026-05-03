import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AWSRegionGlobe3D, AWSRegionPoint } from './AWSRegionGlobe3D';

const REGIONS: AWSRegionPoint[] = [
  { id: 'us-east-1', name: 'N. Virginia', lat: 39, lon: -77, status: 'unknown' },
  { id: 'us-east-2', name: 'Ohio', lat: 40, lon: -82, status: 'unknown' },
  { id: 'us-west-1', name: 'N. California', lat: 37, lon: -122, status: 'unknown' },
  { id: 'us-west-2', name: 'Oregon', lat: 45, lon: -122, status: 'unknown' },
  { id: 'ca-central-1', name: 'Canada', lat: 45, lon: -73, status: 'unknown' },
  { id: 'eu-west-1', name: 'Ireland', lat: 53, lon: -8, status: 'unknown' },
  { id: 'eu-west-2', name: 'London', lat: 51, lon: -0.1, status: 'unknown' },
  { id: 'eu-west-3', name: 'Paris', lat: 48, lon: 2, status: 'unknown' },
  { id: 'eu-central-1', name: 'Frankfurt', lat: 50, lon: 9, status: 'unknown' },
  { id: 'eu-north-1', name: 'Stockholm', lat: 59, lon: 18, status: 'unknown' },
  { id: 'eu-south-1', name: 'Milan', lat: 45, lon: 9, status: 'unknown' },
  { id: 'ap-northeast-1', name: 'Tokyo', lat: 35, lon: 139, status: 'unknown' },
  { id: 'ap-northeast-2', name: 'Seoul', lat: 37, lon: 127, status: 'unknown' },
  { id: 'ap-southeast-1', name: 'Singapore', lat: 1, lon: 104, status: 'unknown' },
  { id: 'ap-southeast-2', name: 'Sydney', lat: -34, lon: 151, status: 'unknown' },
  { id: 'ap-south-1', name: 'Mumbai', lat: 19, lon: 73, status: 'unknown' },
  { id: 'sa-east-1', name: 'Sao Paulo', lat: -23, lon: -47, status: 'unknown' },
  { id: 'me-south-1', name: 'Bahrain', lat: 26, lon: 50, status: 'unknown' },
  { id: 'af-south-1', name: 'Cape Town', lat: -34, lon: 18, status: 'unknown' },
  { id: 'il-central-1', name: 'Israel', lat: 31, lon: 35, status: 'unknown' },
];

const REGION_GROUPS = [
  { label: 'Americas', match: (id: string) => id.startsWith('us-') || id.startsWith('ca-') || id.startsWith('sa-') },
  { label: 'Europe', match: (id: string) => id.startsWith('eu-') },
  { label: 'Asia Pacific', match: (id: string) => id.startsWith('ap-') },
  { label: 'Middle East + Africa', match: (id: string) => id.startsWith('me-') || id.startsWith('af-') || id.startsWith('il-') },
];

export const AWSStatusModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);
  const activeRegion = REGIONS.find(region => region.id === hoveredRegion) || REGIONS.find(region => region.id === 'ap-south-1') || REGIONS[0];

  const grouped = useMemo(() => REGION_GROUPS.map(group => ({
    ...group,
    regions: REGIONS.filter(region => group.match(region.id)),
  })), []);

  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="aws-modal"
        initial={{ scale: 0.9, opacity: 0, y: 26 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 260 }}
        onClick={event => event.stopPropagation()}
      >
        <div className="aws-modal-header">
          <div className="aws-modal-title-row">
            <div className="aws-modal-title">
              <motion.span
                className="aws-title-dot"
                animate={{ scale: [1, 1.7, 1], opacity: [0.8, 0.35, 0.8] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              />
              AWS REGION MAP
            </div>
            <div className="aws-modal-sub">Three.js region topology and S3 proximity view</div>
          </div>
          <motion.button
            className="upload-close-btn"
            onClick={onClose}
            whileHover={{ rotate: 90, scale: 1.15, borderColor: 'var(--danger)', color: 'var(--danger)' }}
            whileTap={{ scale: 0.86 }}
            transition={{ type: 'spring', stiffness: 400, damping: 12 }}
          >x</motion.button>
        </div>

        <div className="aws-modal-body">
          <section className="aws-globe-pane">
            <div className="aws-globe-frame">
              <AWSRegionGlobe3D regions={REGIONS} hoveredRegion={hoveredRegion} onHover={setHoveredRegion} />
              <motion.div
                className="aws-region-callout"
                key={activeRegion.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22 }}
              >
                <span>{activeRegion.name}</span>
                <strong>{activeRegion.id}</strong>
              </motion.div>
            </div>
            <div className="aws-globe-legend">
              <span className="aws-legend-item"><span className="aws-legend-dot region" /> Region node</span>
              <span className="aws-legend-item"><span className="aws-legend-dot flow" /> Backbone flow</span>
              <span className="aws-legend-item"><span className="aws-legend-dot home" /> Active bucket region</span>
            </div>
          </section>

          <aside className="aws-status-pane">
            <div className="aws-status-card">
              <span className="aws-status-label">Selected region</span>
              <strong>{activeRegion.name}</strong>
              <code>{activeRegion.id}</code>
              <p>Hover region nodes or rows to inspect the global storage footprint.</p>
            </div>

            <div className="aws-region-list">
              {grouped.map((group, groupIndex) => (
                <motion.div
                  key={group.label}
                  className="aws-region-group"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: groupIndex * 0.05 }}
                >
                  <div className="aws-region-group-label">{group.label}</div>
                  {group.regions.map(region => (
                    <motion.button
                      key={region.id}
                      className={`aws-region-row${hoveredRegion === region.id ? ' aws-region-hovered' : ''}`}
                      onMouseEnter={() => setHoveredRegion(region.id)}
                      onMouseLeave={() => setHoveredRegion(null)}
                      whileHover={{ x: 3 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <span className="aws-region-dot" />
                      <span className="aws-region-name">{region.name}</span>
                      <span className="aws-region-id">{region.id}</span>
                    </motion.button>
                  ))}
                </motion.div>
              ))}
            </div>

            <AnimatePresence>
              <motion.div
                className="aws-status-summary"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <span>i</span>
                AWS no longer provides the old public status feed. This map shows region locations and topology.
              </motion.div>
            </AnimatePresence>
          </aside>
        </div>
      </motion.div>
    </motion.div>
  );
};
