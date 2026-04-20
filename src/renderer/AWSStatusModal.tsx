import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface AWSRegion {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

const REGIONS: AWSRegion[] = [
  { id: 'us-east-1',     name: 'N. Virginia',  lat: 39,  lon: -77  },
  { id: 'us-east-2',     name: 'Ohio',          lat: 40,  lon: -82  },
  { id: 'us-west-1',     name: 'N. California', lat: 37,  lon: -122 },
  { id: 'us-west-2',     name: 'Oregon',        lat: 45,  lon: -122 },
  { id: 'ca-central-1',  name: 'Canada',        lat: 45,  lon: -73  },
  { id: 'eu-west-1',     name: 'Ireland',       lat: 53,  lon: -8   },
  { id: 'eu-west-2',     name: 'London',        lat: 51,  lon: -0.1 },
  { id: 'eu-west-3',     name: 'Paris',         lat: 48,  lon: 2    },
  { id: 'eu-central-1',  name: 'Frankfurt',     lat: 50,  lon: 9    },
  { id: 'eu-north-1',    name: 'Stockholm',     lat: 59,  lon: 18   },
  { id: 'eu-south-1',    name: 'Milan',         lat: 45,  lon: 9    },
  { id: 'ap-northeast-1',name: 'Tokyo',         lat: 35,  lon: 139  },
  { id: 'ap-northeast-2',name: 'Seoul',         lat: 37,  lon: 127  },
  { id: 'ap-southeast-1',name: 'Singapore',     lat: 1,   lon: 104  },
  { id: 'ap-southeast-2',name: 'Sydney',        lat: -34, lon: 151  },
  { id: 'ap-south-1',    name: 'Mumbai',        lat: 19,  lon: 73   },
  { id: 'sa-east-1',     name: 'São Paulo',     lat: -23, lon: -47  },
  { id: 'me-south-1',    name: 'Bahrain',       lat: 26,  lon: 50   },
  { id: 'af-south-1',    name: 'Cape Town',     lat: -34, lon: 18   },
  { id: 'il-central-1',  name: 'Israel',        lat: 31,  lon: 35   },
];

// Orthographic projection
function project(lat: number, lon: number, lon0: number, R: number, cx: number, cy: number) {
  const phi = (lat * Math.PI) / 180;
  const lambda = ((lon - lon0) * Math.PI) / 180;
  const cosLambda = Math.cos(lambda);
  const cosPhi = Math.cos(phi);
  const x = cx + R * cosPhi * Math.sin(lambda);
  const y = cy - R * Math.sin(phi);
  const visible = cosPhi * cosLambda > 0;
  const depth = cosPhi * cosLambda; // 0..1 depth cue
  return { x, y, visible, depth };
}

// Build SVG path for meridian or parallel
function buildMeridianPath(lon: number, lon0: number, R: number, cx: number, cy: number): string {
  const segs: [number, number][][] = [];
  let seg: [number, number][] = [];
  for (let lat = -80; lat <= 80; lat += 3) {
    const { x, y, visible } = project(lat, lon, lon0, R, cx, cy);
    if (visible) {
      seg.push([x, y]);
    } else {
      if (seg.length > 1) segs.push(seg);
      seg = [];
    }
  }
  if (seg.length > 1) segs.push(seg);
  return segs.map(s =>
    s.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')
  ).join('');
}

function buildParallelPath(lat: number, lon0: number, R: number, cx: number, cy: number): string {
  const segs: [number, number][][] = [];
  let seg: [number, number][] = [];
  for (let lon = 0; lon <= 360; lon += 3) {
    const { x, y, visible } = project(lat, lon, lon0, R, cx, cy);
    if (visible) {
      seg.push([x, y]);
    } else {
      if (seg.length > 1) segs.push(seg);
      seg = [];
    }
  }
  if (seg.length > 1) segs.push(seg);
  return segs.map(s =>
    s.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')
  ).join('');
}

// Simplified continent coastlines as [lat, lon][] polygons
const CONTINENT_OUTLINES: [number, number][][] = [
  // North America
  [[70,-140],[72,-96],[68,-76],[62,-68],[47,-53],[44,-66],[38,-75],[25,-80],[24,-82],[29,-88],[26,-97],[22,-97],[20,-100],[18,-107],[22,-110],[28,-110],[31,-117],[33,-117],[38,-122],[46,-124],[50,-127],[56,-130],[60,-140],[70,-140]],
  // Greenland
  [[60,-43],[63,-51],[68,-53],[75,-60],[82,-65],[83,-36],[76,-18],[70,-22],[65,-37],[60,-43]],
  // South America
  [[11,-72],[10,-62],[5,-53],[1,-51],[-5,-35],[-8,-35],[-13,-39],[-20,-40],[-23,-43],[-33,-52],[-40,-62],[-45,-65],[-50,-69],[-55,-68],[-46,-74],[-38,-58],[-22,-43],[-5,-35],[5,-52],[8,-60],[11,-72]],
  // Europe
  [[71,28],[69,18],[64,14],[58,5],[51,2],[48,-5],[43,-9],[36,-6],[39,-9],[43,-1],[46,12],[44,14],[40,18],[40,28],[44,33],[46,30],[49,32],[55,22],[57,21],[60,24],[60,20],[58,10],[55,8],[57,10],[60,5],[64,14],[67,14],[71,28]],
  // Africa
  [[37,10],[32,32],[22,37],[11,43],[4,42],[0,42],[-5,40],[-10,40],[-16,35],[-26,33],[-34,26],[-35,20],[-20,13],[-10,13],[0,8],[4,2],[5,-3],[10,-15],[20,-17],[25,-15],[33,-8],[37,10]],
  // Asia (West+Central)
  [[70,30],[72,50],[70,70],[72,100],[68,130],[60,140],[55,135],[50,140],[45,132],[39,122],[30,122],[22,114],[12,109],[5,100],[1,104],[8,98],[20,92],[25,95],[28,88],[27,84],[25,72],[16,74],[8,77],[0,73],[22,60],[26,56],[30,60],[35,60],[38,68],[40,66],[44,50],[48,48],[54,54],[60,58],[65,60],[70,60],[72,50],[70,30]],
  // Australia
  [[-14,126],[-12,130],[-12,136],[-16,136],[-16,140],[-20,148],[-24,152],[-28,154],[-34,151],[-38,147],[-38,145],[-36,137],[-32,134],[-32,128],[-34,118],[-22,114],[-16,122],[-14,126]],
  // UK/Ireland rough
  [[58,-5],[55,-6],[54,-6],[52,-4],[51,1],[53,1],[55,-2],[58,-5]],
];

function buildContinentPath(poly: [number, number][], lon0: number, R: number, cx: number, cy: number): string {
  const segs: string[] = [];
  let inSeg = false;
  for (const [lat, lon] of poly) {
    const { x, y, visible } = project(lat, lon, lon0, R, cx, cy);
    if (visible) {
      segs.push(`${inSeg ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`);
      inSeg = true;
    } else {
      inSeg = false;
    }
  }
  return segs.join('');
}

// Great-circle distance in degrees
function gcDist(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  return (Math.acos(Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl)) * 180) / Math.PI;
}

type StatusLevel = 'ok' | 'warn' | 'error' | 'unknown';

const STATUS_COLOR: Record<StatusLevel, string> = {
  ok: '#34d399',
  warn: '#fbbf24',
  error: '#f87171',
  unknown: '#6b7280',
};

export const AWSStatusModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [lon0, setLon0] = useState(20);
  const animRef = useRef<number>(0);
  const lastTsRef = useRef<number>(0);
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);

  // Globe animation
  useEffect(() => {
    const step = (ts: number) => {
      const dt = lastTsRef.current ? ts - lastTsRef.current : 16;
      lastTsRef.current = ts;
      setLon0(prev => (prev + dt * 0.007) % 360);
      animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  const getRegionStatus = (_id: string): StatusLevel => 'unknown';

  // Globe geometry
  const R = 130;
  const cx = 165;
  const cy = 165;
  const SIZE = 330;

  const meridians = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180];
  const parallels = [-60, -30, 0, 30, 60];

  const regionDots = REGIONS.map(r => {
    const proj = project(r.lat, r.lon, lon0, R, cx, cy);
    return { ...r, ...proj, status: getRegionStatus(r.id) };
  });

  // Connection edges between regions closer than 42 degrees
  const edges: { x1: number; y1: number; x2: number; y2: number; depth: number }[] = [];
  for (let i = 0; i < regionDots.length; i++) {
    for (let j = i + 1; j < regionDots.length; j++) {
      const a = regionDots[i];
      const b = regionDots[j];
      if (!a.visible || !b.visible) continue;
      if (gcDist(a.lat, a.lon, b.lat, b.lon) > 42) continue;
      edges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, depth: (a.depth + b.depth) / 2 });
    }
  }

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
        initial={{ scale: 0.88, opacity: 0, y: 24 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0 }}
        transition={{ type: 'spring', damping: 24, stiffness: 260 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="aws-modal-header">
          <div className="aws-modal-title-row">
            <div className="aws-modal-title">
              <motion.div
                className="aws-title-dot"
                animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                style={{ background: '#6b7280' }}
              />
              AWS REGION MAP
            </div>
            <div className="aws-modal-sub">
              Live status API unavailable · region locations only
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

        <div className="aws-modal-body">
          {/* Globe pane */}
          <div className="aws-globe-pane">
            <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ overflow: 'visible' }}>
              <defs>
                <clipPath id="globe-clip">
                  <circle cx={cx} cy={cy} r={R} />
                </clipPath>
                <radialGradient id="globe-glow" cx="40%" cy="35%">
                  <stop offset="0%" stopColor="rgba(155,92,246,0.18)" />
                  <stop offset="100%" stopColor="rgba(9,7,20,0.95)" />
                </radialGradient>
                <filter id="edge-glow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="1.8" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Globe base */}
              <circle cx={cx} cy={cy} r={R} fill="url(#globe-glow)" />

              {/* Grid lines */}
              <g clipPath="url(#globe-clip)" opacity="0.22">
                {meridians.map(lon => {
                  const d = buildMeridianPath(lon, lon0, R, cx, cy);
                  return d ? <path key={`m${lon}`} d={d} stroke="rgba(155,92,246,0.9)" strokeWidth="0.6" fill="none" /> : null;
                })}
                {parallels.map(lat => {
                  const d = buildParallelPath(lat, lon0, R, cx, cy);
                  return d ? <path key={`p${lat}`} d={d} stroke="rgba(155,92,246,0.9)" strokeWidth="0.6" fill="none" /> : null;
                })}
                {/* Equator slightly stronger */}
                {(() => {
                  const d = buildParallelPath(0, lon0, R, cx, cy);
                  return d ? <path d={d} stroke="rgba(155,92,246,0.7)" strokeWidth="1" fill="none" /> : null;
                })()}
              </g>

              {/* Continent outlines */}
              <g clipPath="url(#globe-clip)">
                {CONTINENT_OUTLINES.map((poly, i) => {
                  const d = buildContinentPath(poly, lon0, R, cx, cy);
                  return d ? <path key={i} d={d} stroke="rgba(155,92,246,0.55)" strokeWidth="1" fill="rgba(155,92,246,0.07)" /> : null;
                })}
              </g>

              {/* Data-flow connection lines — green glowing pulses */}
              <g clipPath="url(#globe-clip)" filter="url(#edge-glow)">
                {edges.map((e, i) => (
                  <motion.line
                    key={i}
                    x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                    stroke="#34d399"
                    strokeWidth={1}
                    strokeLinecap="round"
                    animate={{ opacity: [0.05, 0.6, 0.05] }}
                    transition={{
                      duration: 1.4 + (i % 7) * 0.25,
                      repeat: Infinity,
                      ease: 'easeInOut',
                      delay: (i * 0.17) % 2.2,
                    }}
                  />
                ))}
              </g>
              {/* Traveling dots along edges */}
              <g clipPath="url(#globe-clip)">
                {edges.filter((_, i) => i % 2 === 0).map((e, i) => {
                  const mid = { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 };
                  return (
                    <motion.circle
                      key={`dot-${i}`}
                      cx={mid.x} cy={mid.y} r={1.5}
                      fill="#34d399"
                      style={{ filter: 'drop-shadow(0 0 3px #34d399)' }}
                      animate={{ opacity: [0, 1, 0], scale: [0.5, 1.4, 0.5] }}
                      transition={{
                        duration: 1.4 + (i % 5) * 0.3,
                        repeat: Infinity,
                        ease: 'easeInOut',
                        delay: (i * 0.23) % 2,
                      }}
                    />
                  );
                })}
              </g>

              {/* Globe border */}
              <circle cx={cx} cy={cy} r={R}
                fill="none"
                stroke="rgba(155,92,246,0.5)"
                strokeWidth="1.5"
              />
              {/* Glow ring */}
              <motion.circle cx={cx} cy={cy} r={R}
                fill="none"
                stroke="rgba(155,92,246,0.2)"
                strokeWidth="6"
                animate={{ opacity: [0.4, 0.8, 0.4] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              />

              {/* Region dots */}
              {regionDots.filter(r => r.visible).map(r => {
                const col = STATUS_COLOR[r.status];
                const isHovered = hoveredRegion === r.id;
                return (
                  <g key={r.id}
                    onMouseEnter={() => setHoveredRegion(r.id)}
                    onMouseLeave={() => setHoveredRegion(null)}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Glow halo */}
                    <motion.circle
                      cx={r.x} cy={r.y} r={isHovered ? 10 : 7}
                      fill={col}
                      opacity={0.18}
                      animate={{ r: [6, 10, 6], opacity: [0.1, 0.25, 0.1] }}
                      transition={{ duration: 2.5 + Math.random() * 1, repeat: Infinity, ease: 'easeInOut' }}
                    />
                    {/* Dot */}
                    <circle
                      cx={r.x} cy={r.y}
                      r={isHovered ? 5 : 3.5}
                      fill={col}
                      style={{ filter: `drop-shadow(0 0 4px ${col})` }}
                    />
                    {/* Label on hover */}
                    <AnimatePresence>
                      {isHovered && (
                        <motion.g
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                        >
                          <rect
                            x={r.x + 8} y={r.y - 10}
                            width={r.name.length * 6.2 + 10} height={18}
                            rx={3} fill="rgba(13,11,22,0.9)"
                            stroke={col} strokeWidth="0.8"
                          />
                          <text
                            x={r.x + 13} y={r.y + 3}
                            fill={col}
                            fontSize="9.5"
                            fontFamily="monospace"
                          >{r.name}</text>
                        </motion.g>
                      )}
                    </AnimatePresence>
                  </g>
                );
              })}
            </svg>

            <div className="aws-globe-legend">
              <span className="aws-legend-item">
                <span className="aws-legend-dot" style={{ background: '#6b7280' }} />
                Region
              </span>
              <span className="aws-legend-item">
                <span className="aws-legend-dot" style={{ background: '#34d399', boxShadow: '0 0 5px #34d399' }} />
                Data flow
              </span>
            </div>
          </div>

          {/* Status pane */}
          <div className="aws-status-pane">
            <div className="aws-status-label">REGIONS</div>
            <div className="aws-region-list">
              {REGIONS.map((r, i) => {
                const st = getRegionStatus(r.id);
                const col = STATUS_COLOR[st];
                const isActive = regionDots.find(d => d.id === r.id)?.visible;
                return (
                  <motion.div
                    key={r.id}
                    className={`aws-region-row${hoveredRegion === r.id ? ' aws-region-hovered' : ''}`}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    onMouseEnter={() => setHoveredRegion(r.id)}
                    onMouseLeave={() => setHoveredRegion(null)}
                    style={{ opacity: isActive ? 1 : 0.5 }}
                  >
                    <span className="aws-region-dot" style={{ background: col }} />
                    <span className="aws-region-name">{r.name}</span>
                    <span className="aws-region-id">{r.id}</span>
                    <span className="aws-region-status" style={{ color: col }}>·</span>
                  </motion.div>
                );
              })}
            </div>

            {/* Summary footer */}
            <motion.div
              className="aws-status-summary"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ borderColor: '#6b728040', background: '#6b728008' }}
            >
              <span style={{ color: '#6b7280' }}>ℹ</span>{' '}
              AWS public status API discontinued · {REGIONS.length} regions shown
            </motion.div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
