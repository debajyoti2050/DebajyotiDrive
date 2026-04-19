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

// Great-circle distance in degrees
function gcDist(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  return (Math.acos(Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl)) * 180) / Math.PI;
}

type StatusLevel = 'ok' | 'warn' | 'error';
interface ServiceStatus { name: string; status: StatusLevel; description?: string }

const STATUS_COLOR: Record<StatusLevel, string> = {
  ok: '#34d399',
  warn: '#fbbf24',
  error: '#f87171',
};

export const AWSStatusModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [lon0, setLon0] = useState(20);
  const animRef = useRef<number>(0);
  const lastTsRef = useRef<number>(0);

  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [fetchState, setFetchState] = useState<'loading' | 'ok' | 'error'>('loading');
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

  // Fetch AWS status
  useEffect(() => {
    (async () => {
      try {
        const res = await window.s3drive.shell.fetchAWSStatus();
        if (!res.ok) throw new Error(res.error);
        const data = JSON.parse(res.value) as {
          current?: Array<{ service_name: string; status: number; description: string }>;
        };
        const current = data.current ?? [];
        const list: ServiceStatus[] = current.map(e => ({
          name: e.service_name,
          status: e.status >= 3 ? 'error' : e.status >= 1 ? 'warn' : 'ok',
          description: e.description,
        }));
        setServices(list);
        setFetchState('ok');
      } catch {
        setFetchState('error');
        setServices([]);
      }
    })();
  }, []);

  const getRegionStatus = (id: string): StatusLevel => {
    if (fetchState !== 'ok') return 'ok';
    const affected = services.filter(s =>
      s.name.toLowerCase().includes(id.split('-').slice(0, 2).join('-'))
    );
    if (affected.some(s => s.status === 'error')) return 'error';
    if (affected.some(s => s.status === 'warn')) return 'warn';
    return 'ok';
  };

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

  const overallOk = services.every(s => s.status === 'ok');
  const hasIssues = services.some(s => s.status !== 'ok');

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
                style={{ background: fetchState === 'loading' ? '#fbbf24' : hasIssues ? '#f87171' : '#34d399' }}
              />
              AWS SERVICE HEALTH
            </div>
            <div className="aws-modal-sub">
              {fetchState === 'loading' && 'Fetching live status…'}
              {fetchState === 'ok' && (hasIssues
                ? `${services.filter(s => s.status !== 'ok').length} service(s) with issues`
                : 'All systems operational')}
              {fetchState === 'error' && 'Unable to fetch status — showing all green'}
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

              {/* Connection lines */}
              <g clipPath="url(#globe-clip)">
                {edges.map((e, i) => (
                  <motion.line
                    key={i}
                    x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                    stroke="rgba(155,92,246,0.3)"
                    strokeWidth={0.8}
                    strokeDasharray="3 4"
                    animate={{ opacity: [0.2, 0.55, 0.2] }}
                    transition={{ duration: 3 + i * 0.15, repeat: Infinity, ease: 'easeInOut', delay: (i * 0.2) % 3 }}
                  />
                ))}
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
                    <motion.circle
                      cx={r.x} cy={r.y}
                      r={isHovered ? 5 : 3.5}
                      fill={col}
                      animate={{ scale: r.status !== 'ok' ? [1, 1.3, 1] : 1 }}
                      transition={{ duration: 1.2, repeat: Infinity }}
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
              {(['ok', 'warn', 'error'] as StatusLevel[]).map(s => (
                <span key={s} className="aws-legend-item">
                  <span className="aws-legend-dot" style={{ background: STATUS_COLOR[s] }} />
                  {s === 'ok' ? 'Operational' : s === 'warn' ? 'Degraded' : 'Outage'}
                </span>
              ))}
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
                    <motion.span
                      className="aws-region-dot"
                      style={{ background: col }}
                      animate={st !== 'ok' ? { scale: [1, 1.4, 1] } : {}}
                      transition={{ duration: 1.2, repeat: Infinity }}
                    />
                    <span className="aws-region-name">{r.name}</span>
                    <span className="aws-region-id">{r.id}</span>
                    <span className="aws-region-status" style={{ color: col }}>
                      {st === 'ok' ? '✓' : st === 'warn' ? '⚠' : '✕'}
                    </span>
                  </motion.div>
                );
              })}
            </div>

            {/* Summary footer */}
            <AnimatePresence mode="wait">
              <motion.div
                key={fetchState + String(hasIssues)}
                className="aws-status-summary"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                style={{
                  borderColor: fetchState === 'ok' && hasIssues ? '#f87171' : '#34d39940',
                  background: fetchState === 'ok' && hasIssues ? '#f8717108' : '#34d39908',
                }}
              >
                {fetchState === 'loading' && (
                  <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1, repeat: Infinity }}>
                    Checking AWS health dashboard…
                  </motion.span>
                )}
                {fetchState === 'ok' && (
                  overallOk || services.length === 0
                    ? <><span style={{ color: '#34d399' }}>✓</span> All {REGIONS.length} regions operational</>
                    : <><span style={{ color: '#f87171' }}>⚠</span> {services.filter(s => s.status !== 'ok').length} issue(s) detected</>
                )}
                {fetchState === 'error' && (
                  <><span style={{ color: '#fbbf24' }}>⚡</span> Status check unavailable</>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
