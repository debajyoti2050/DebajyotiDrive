import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, animate } from 'framer-motion';
import type { BucketAnalytics, TierStats } from '@shared/types';
import { STORAGE_CLASSES } from '@shared/types';
import { formatBytes, formatDate } from './utils';

interface Props {
  onClose: () => void;
  onToast: (msg: string, kind?: 'info' | 'error' | 'success') => void;
}

const USD_TO_INR = 84;

function formatINR(usd: number): string {
  const inr = usd * USD_TO_INR;
  if (inr < 1) return '< ₹1';
  if (inr < 1000) return `₹${inr.toFixed(0)}`;
  return `₹${Math.round(inr).toLocaleString('en-IN')}`;
}

function formatUSD(usd: number): string {
  if (usd < 0.005) return '< $0.01';
  return `$${usd.toFixed(2)}`;
}

function formatUSDPerGB(value?: number): string {
  if (value === undefined) return 'rate unavailable';
  if (value < 0.0001) return '< $0.0001/GB-mo';
  return `$${value.toFixed(5).replace(/0+$/, '').replace(/\.$/, '')}/GB-mo`;
}

function pricingSourceLabel(source: BucketAnalytics['pricingSource']): string {
  return source === 'aws-pricing-api' ? 'AWS Pricing API live rates' : 'static fallback rates';
}

function tierColor(sc: string): string {
  const t = STORAGE_CLASSES.find(c => c.id === sc)?.costTier ?? 1;
  return `var(--tier-${t})`;
}

function tierLabel(sc: string): string {
  return STORAGE_CLASSES.find(c => c.id === sc)?.label ?? sc;
}

// ── storage history (localStorage snapshots) ─────────────────────────────────

interface StorageSnapshot { ts: number; bytes: number; objects: number; cost: number; }
const HISTORY_KEY = 's3drive_storage_history';
const MAX_SNAPS = 30;

function loadHistory(): StorageSnapshot[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]'); } catch { return []; }
}

function saveSnapshot(data: { totalBytes: number; totalObjects: number; estimatedMonthlyCost: number }) {
  const snaps = loadHistory();
  const now = Date.now();
  // Avoid duplicate entries within 10 minutes
  if (snaps.length && now - snaps[snaps.length - 1].ts < 10 * 60 * 1000) {
    snaps[snaps.length - 1] = { ts: snaps[snaps.length - 1].ts, bytes: data.totalBytes, objects: data.totalObjects, cost: data.estimatedMonthlyCost };
  } else {
    snaps.push({ ts: now, bytes: data.totalBytes, objects: data.totalObjects, cost: data.estimatedMonthlyCost });
  }
  const trimmed = snaps.slice(-MAX_SNAPS);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  return trimmed;
}

// ── storage history chart ─────────────────────────────────────────────────────

function StorageHistoryChart({ snaps }: { snaps: StorageSnapshot[] }) {
  if (snaps.length < 2) return (
    <div style={{ color: 'var(--text-faint)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
      Scan again later to build history
    </div>
  );

  const W = 560, H = 100, PAD = { t: 8, b: 22, l: 48, r: 12 };
  const iW = W - PAD.l - PAD.r, iH = H - PAD.t - PAD.b;

  const maxB = Math.max(...snaps.map(s => s.bytes), 1);
  const minB = Math.min(...snaps.map(s => s.bytes));
  const range = maxB - minB || 1;

  const xs = snaps.map((_, i) => PAD.l + (i / (snaps.length - 1)) * iW);
  const ys = snaps.map(s => PAD.t + iH - ((s.bytes - minB) / range) * iH);

  const linePath = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${xs[xs.length - 1].toFixed(1)},${(PAD.t + iH).toFixed(1)} L${PAD.l.toFixed(1)},${(PAD.t + iH).toFixed(1)} Z`;

  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  // Y-axis labels (top & bottom)
  const yTop = formatBytes(maxB), yBot = formatBytes(minB);

  return (
    <div style={{ position: 'relative' }}>
      <svg width={W} height={H} style={{ overflow: 'visible', display: 'block' }}>
        <defs>
          <linearGradient id="histGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[0, 0.5, 1].map(t => {
          const y = PAD.t + t * iH;
          return <line key={t} x1={PAD.l} x2={PAD.l + iW} y1={y} y2={y} stroke="var(--line)" strokeWidth={1} strokeDasharray="3 3" />;
        })}

        {/* Area fill */}
        <motion.path
          d={areaPath}
          fill="url(#histGrad)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.6 }}
        />

        {/* Line */}
        <motion.path
          d={linePath}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.2, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.1 }}
        />

        {/* Data points */}
        {xs.map((x, i) => (
          <motion.circle
            key={i}
            cx={x} cy={ys[i]} r={3}
            fill="var(--bg)" stroke="var(--accent)" strokeWidth={1.5}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1 + i * 0.06, type: 'spring', damping: 18, stiffness: 320 }}
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          >
            <title>{fmtDate(snaps[i].ts)}: {formatBytes(snaps[i].bytes)}</title>
          </motion.circle>
        ))}

        {/* Y axis labels */}
        <text x={PAD.l - 4} y={PAD.t + 4} textAnchor="end" fontSize={9} fill="var(--text-faint)" fontFamily="var(--mono)">{yTop}</text>
        <text x={PAD.l - 4} y={PAD.t + iH + 1} textAnchor="end" fontSize={9} fill="var(--text-faint)" fontFamily="var(--mono)">{yBot}</text>

        {/* X axis first/last dates */}
        <text x={PAD.l} y={H - 4} textAnchor="start" fontSize={9} fill="var(--text-faint)" fontFamily="var(--mono)">{fmtDate(snaps[0].ts)}</text>
        <text x={PAD.l + iW} y={H - 4} textAnchor="end" fontSize={9} fill="var(--text-faint)" fontFamily="var(--mono)">{fmtDate(snaps[snaps.length - 1].ts)}</text>
      </svg>
    </div>
  );
}

// ── count-up hook ─────────────────────────────────────────────────────────────

function useCountUp(to: number, duration = 1.5): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (to === 0) { setVal(0); return; }
    const ctrl = animate(0, to, { duration, ease: 'easeOut', onUpdate: setVal });
    return ctrl.stop;
  }, [to, duration]);
  return val;
}

// ── loading animation ─────────────────────────────────────────────────────────

function SonarLoader() {
  return (
    <div style={{ position: 'relative', width: 90, height: 90 }}>
      {[0, 1, 2].map(i => (
        <motion.div
          key={i}
          style={{
            position: 'absolute',
            inset: i * 14,
            borderRadius: '50%',
            border: '1.5px solid var(--accent)',
          }}
          animate={{ opacity: [0, 0.75, 0], scale: [0.75, 1.25, 0.75] }}
          transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.55, ease: 'easeInOut' }}
        />
      ))}
      <motion.div
        style={{
          position: 'absolute', inset: 32,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(155,92,246,0.9) 0%, rgba(109,40,217,0.5) 100%)',
        }}
        animate={{ scale: [1, 1.35, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

// ── stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  rawValue: number;
  formatFn: (n: number) => string;
  sub?: string;
  delay?: number;
}

function StatCard({ label, rawValue, formatFn, sub, delay = 0 }: StatCardProps) {
  const counted = useCountUp(rawValue, 1.5);
  return (
    <motion.div
      className="dash-stat-card"
      initial={{ opacity: 0, y: 22 }}
      animate={{
        opacity: 1, y: 0,
        boxShadow: [
          '0 0 0 1px rgba(155,92,246,0.12), 0 2px 8px rgba(0,0,0,0.3)',
          '0 0 16px rgba(155,92,246,0.35), 0 2px 12px rgba(0,0,0,0.3)',
          '0 0 0 1px rgba(155,92,246,0.12), 0 2px 8px rgba(0,0,0,0.3)',
        ],
      }}
      transition={{
        opacity: { delay, duration: 0.45 },
        y: { delay, type: 'spring', damping: 22, stiffness: 280 },
        boxShadow: { delay: delay + 0.6, duration: 3.5, repeat: Infinity, ease: 'easeInOut' },
      }}
    >
      <div className="dash-stat-label">{label}</div>
      <motion.div
        className="dash-stat-value"
        animate={{ color: ['var(--text)', 'rgba(196,181,253,1)', 'var(--text)'] }}
        transition={{ delay: delay + 0.4, duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
      >
        {formatFn(counted)}
      </motion.div>
      {sub && <div className="dash-stat-sub">{sub}</div>}
    </motion.div>
  );
}

// ── donut chart ───────────────────────────────────────────────────────────────

interface DonutSlice { color: string; fraction: number; label: string; bytes: number }

function DonutChart({ slices }: { slices: DonutSlice[] }) {
  const cx = 100, cy = 100, R = 80, r = 50;
  let angle = -Math.PI / 2;
  const paths: React.ReactNode[] = [];

  slices.forEach((s, idx) => {
    if (s.fraction <= 0) return;
    const sweep = s.fraction * 2 * Math.PI;
    const end   = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;

    const x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle);
    const x2 = cx + R * Math.cos(end),   y2 = cy + R * Math.sin(end);
    const x3 = cx + r * Math.cos(end),   y3 = cy + r * Math.sin(end);
    const x4 = cx + r * Math.cos(angle), y4 = cy + r * Math.sin(angle);

    paths.push(
      <motion.path
        key={s.label}
        d={`M${x1} ${y1} A${R} ${R} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${r} ${r} 0 ${large} 0 ${x4} ${y4}Z`}
        fill={s.color}
        stroke="var(--bg-elev)"
        strokeWidth="2"
        initial={{ opacity: 0, scale: 0.65 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: idx * 0.09, duration: 0.55, ease: [0.34, 1.56, 0.64, 1] }}
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        whileHover={{ scale: 1.06, filter: 'brightness(1.2)' }}
      >
        <title>{s.label}: {formatBytes(s.bytes)}</title>
      </motion.path>
    );
    angle = end;
  });

  return (
    <motion.div
      style={{ position: 'relative', display: 'inline-block' }}
      animate={{ filter: ['drop-shadow(0 0 6px rgba(155,92,246,0.25))', 'drop-shadow(0 0 18px rgba(155,92,246,0.65))', 'drop-shadow(0 0 6px rgba(155,92,246,0.25))'] }}
      transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
    >
      <svg viewBox="0 0 200 200" width="160" height="160" style={{ display: 'block', overflow: 'visible' }}>
        {paths}

        {/* Orbiting highlight arc */}
        <motion.g
          style={{ transformBox: 'view-box', transformOrigin: '50% 50%' }}
          animate={{ rotate: 360 }}
          transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
        >
          <circle
            cx={100} cy={100} r={80}
            fill="none"
            stroke="rgba(255,255,255,0.22)"
            strokeWidth={7}
            strokeDasharray="48 455"
            strokeLinecap="round"
          />
        </motion.g>

        {/* Counter-orbiting inner arc */}
        <motion.g
          style={{ transformBox: 'view-box', transformOrigin: '50% 50%' }}
          animate={{ rotate: -360 }}
          transition={{ duration: 16, repeat: Infinity, ease: 'linear' }}
        >
          <circle
            cx={100} cy={100} r={50}
            fill="none"
            stroke="rgba(155,92,246,0.3)"
            strokeWidth={4}
            strokeDasharray="28 286"
            strokeLinecap="round"
          />
        </motion.g>

        <motion.text
          x="100" y="95"
          textAnchor="middle" fill="var(--text-faint)" fontSize="9"
          fontFamily="inherit" letterSpacing="0.08em"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
        >
          STORAGE
        </motion.text>
        <motion.text
          x="100" y="110"
          textAnchor="middle" fill="var(--text)" fontSize="9"
          fontFamily="inherit" letterSpacing="0.08em"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}
        >
          BY TIER
        </motion.text>
      </svg>
    </motion.div>
  );
}

// ── tier bar row ──────────────────────────────────────────────────────────────

function TierRow({ t, maxBytes, delay = 0 }: { t: TierStats; maxBytes: number; delay?: number }) {
  const pct = maxBytes > 0 ? (t.totalBytes / maxBytes) * 100 : 0;
  const color = tierColor(t.storageClass);
  return (
    <motion.div
      className="dash-tier-row"
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <div className="dash-tier-name">
        <motion.span
          className="dash-tier-dot"
          style={{ background: color }}
          animate={{ scale: [1, 1.5, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 2.5 + delay, repeat: Infinity, ease: 'easeInOut', delay }}
        />
        {tierLabel(t.storageClass)}
      </div>
      <div className="dash-tier-bar-wrap" style={{ position: 'relative', overflow: 'hidden' }}>
        <motion.div
          className="dash-tier-bar-fill"
          style={{ background: color, position: 'relative', overflow: 'hidden' }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ delay: delay + 0.1, duration: 1.0, ease: [0.34, 1.56, 0.64, 1] }}
        >
          {/* shimmer sweep */}
          <motion.div
            style={{
              position: 'absolute', top: 0, bottom: 0, width: '45%',
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
              borderRadius: 'inherit',
            }}
            animate={{ x: ['-100%', '280%'] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'linear', delay: delay + 1.2, repeatDelay: 1.8 }}
          />
        </motion.div>
      </div>
      <div className="dash-tier-meta">
        <span>{formatBytes(t.totalBytes)}</span>
        <span className="dash-tier-count">{t.count.toLocaleString()} obj</span>
        <span
          className="dash-tier-cost"
          title={`${formatUSD(t.estimatedMonthlyCost)}/mo · ${formatUSDPerGB(t.pricePerGBMonth)}`}
        >
          {formatINR(t.estimatedMonthlyCost)}/mo
        </span>
      </div>
    </motion.div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export const DashboardModal: React.FC<Props> = ({ onClose, onToast }) => {
  const [data, setData]       = useState<BucketAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [history, setHistory] = useState<StorageSnapshot[]>(() => loadHistory());

  const scan = async () => {
    setLoading(true);
    setData(null);
    const res = await window.s3drive.s3.analytics();
    setLoading(false);
    setScanned(true);
    if (!res.ok) { onToast(res.error, 'error'); return; }
    setData(res.value);
    setHistory(saveSnapshot(res.value));
    if (res.value.capped) onToast('Scan capped at 50 000 objects — totals are partial.', 'info');
  };

  useEffect(() => { scan(); }, []);

  const donutSlices: DonutSlice[] = (data?.byTier ?? []).map(t => ({
    color:    tierColor(t.storageClass),
    fraction: data!.totalBytes > 0 ? t.totalBytes / data!.totalBytes : 0,
    label:    tierLabel(t.storageClass),
    bytes:    t.totalBytes,
  }));

  const maxTierBytes = data?.byTier[0]?.totalBytes ?? 1;

  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
    >
      <motion.div
        className="modal dash-modal"
        onClick={e => e.stopPropagation()}
        style={{ width: 880, position: 'relative', overflow: 'hidden' }}
        initial={{ scale: 0.96, opacity: 0, y: 14 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 10 }}
        transition={{ type: 'spring', damping: 26, stiffness: 340 }}
      >
        {/* Subtle background aurora orbs */}
        {[
          { w: 300, h: 200, x: -60, y: -60, color: '#7c3aed', dur: 12 },
          { w: 250, h: 250, x: 600, y: 200, color: '#4c1d95', dur: 18 },
        ].map((o, i) => (
          <motion.div
            key={i}
            aria-hidden
            style={{
              position: 'absolute', width: o.w, height: o.h,
              borderRadius: '50%',
              background: `radial-gradient(ellipse, ${o.color}22 0%, transparent 70%)`,
              filter: 'blur(50px)',
              left: o.x, top: o.y,
              pointerEvents: 'none', zIndex: 0,
            }}
            animate={{ x: [0, 30, -20, 30, 0], y: [0, -20, 15, -10, 0], scale: [1, 1.15, 0.9, 1.1, 1] }}
            transition={{ duration: o.dur, repeat: Infinity, ease: 'easeInOut' }}
          />
        ))}

        {/* header */}
        <motion.div
          className="modal-header"
          style={{ position: 'relative', zIndex: 1 }}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <motion.span
              animate={{ rotate: [0, 15, -10, 5, 0], scale: [1, 1.1, 1] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              style={{ display: 'inline-block', fontSize: 18 }}
            >
              ◈
            </motion.span>
            Bucket analytics
            {data && (
              <motion.span
                className="dash-scan-time"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
              >
                {data.region} · scanned {formatDate(data.scannedAt)}
                {data.capped && ' · partial (50k cap)'}
              </motion.span>
            )}
            {/* live pulse indicator */}
            {data && (
              <motion.span
                style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--accent)', display: 'inline-block', marginLeft: 4,
                }}
                animate={{ scale: [1, 1.8, 1], opacity: [1, 0.3, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, position: 'relative', zIndex: 1 }}>
            <motion.button
              className="btn"
              onClick={scan}
              disabled={loading}
              whileHover={{ scale: 1.04, boxShadow: '0 0 12px rgba(155,92,246,0.35)' }}
              whileTap={{ scale: 0.95 }}
            >
              {loading
                ? <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>↻</motion.span>
                    Scanning…
                  </span>
                : '↺ Rescan'
              }
            </motion.button>
            <motion.button
              className="modal-close"
              onClick={onClose}
              whileHover={{ scale: 1.1, rotate: 90, color: 'var(--accent)' }}
              whileTap={{ scale: 0.85 }}
              transition={{ duration: 0.15 }}
            >
              esc
            </motion.button>
          </div>
        </motion.div>

        <div className="modal-body" style={{ padding: 0, position: 'relative', zIndex: 1 }}>
          <AnimatePresence mode="wait">
            {loading && !data && (
              <motion.div
                key="loading"
                className="dash-loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <SonarLoader />
                <motion.span
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                  style={{ marginTop: 16, color: 'var(--text-muted)', fontSize: 13 }}
                >
                  Scanning bucket…
                </motion.span>
              </motion.div>
            )}

            {!loading && !scanned && (
              <motion.div
                key="idle"
                className="dash-loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.button
                  className="btn primary"
                  onClick={scan}
                  whileHover={{ scale: 1.05, boxShadow: '0 0 20px rgba(155,92,246,0.5)' }}
                  whileTap={{ scale: 0.96 }}
                >
                  Scan bucket
                </motion.button>
              </motion.div>
            )}

            {data && (
              <motion.div
                key="data"
                className="dash-body"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
              >
                {/* stat cards */}
                <div className="dash-cards">
                  <StatCard
                    label="Total objects"
                    rawValue={data.totalObjects}
                    formatFn={n => Math.round(n).toLocaleString()}
                    sub={data.capped ? 'partial scan' : `${data.byTier.length} tier(s)`}
                    delay={0}
                  />
                  <StatCard
                    label="Storage used"
                    rawValue={data.totalBytes}
                    formatFn={n => formatBytes(n)}
                    sub={`${(data.totalBytes / 1024 ** 3).toFixed(2)} GB`}
                    delay={0.08}
                  />
                  <StatCard
                    label="Est. monthly cost"
                    rawValue={data.estimatedMonthlyCost}
                    formatFn={n => formatINR(n)}
                    sub={`${formatUSD(data.estimatedMonthlyCost)} · ${pricingSourceLabel(data.pricingSource)}`}
                    delay={0.16}
                  />
                  <StatCard
                    label="Est. annual cost"
                    rawValue={data.estimatedMonthlyCost * 12}
                    formatFn={n => formatINR(n)}
                    sub={`${formatUSD(data.estimatedMonthlyCost * 12)} · projection`}
                    delay={0.24}
                  />
                </div>

                {/* tier breakdown + donut */}
                <div className="dash-mid">
                  <motion.div
                    className="dash-tiers"
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2, duration: 0.4 }}
                  >
                    <motion.div
                      className="dash-section-title"
                      animate={{ color: ['var(--text)', 'rgba(196,181,253,0.9)', 'var(--text)'] }}
                      transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
                    >
                      Storage by tier
                    </motion.div>
                    {data.byTier.length === 0 && (
                      <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>No objects found.</div>
                    )}
                    {data.byTier.map((t, i) => (
                      <TierRow key={t.storageClass} t={t} maxBytes={maxTierBytes} delay={0.25 + i * 0.07} />
                    ))}
                  </motion.div>

                  <motion.div
                    className="dash-donut-wrap"
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.25, duration: 0.4 }}
                  >
                    <motion.div
                      className="dash-section-title"
                      animate={{ color: ['var(--text)', 'rgba(196,181,253,0.9)', 'var(--text)'] }}
                      transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
                    >
                      Distribution
                    </motion.div>
                    {data.byTier.length > 0
                      ? <DonutChart slices={donutSlices} />
                      : <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>No data.</div>
                    }
                    <div className="dash-legend">
                      {data.byTier.map((t, i) => (
                        <motion.div
                          key={t.storageClass}
                          className="dash-legend-row"
                          initial={{ opacity: 0, x: 12 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.4 + i * 0.07 }}
                        >
                          <motion.span
                            className="dash-tier-dot"
                            style={{ background: tierColor(t.storageClass) }}
                            animate={{ scale: [1, 1.6, 1] }}
                            transition={{ duration: 2 + i * 0.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.3 }}
                          />
                          <span>{tierLabel(t.storageClass)}</span>
                          <span style={{ color: 'var(--text-faint)' }}>
                            {data.totalBytes > 0
                              ? `${((t.totalBytes / data.totalBytes) * 100).toFixed(1)}%`
                              : '—'}
                          </span>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                </div>

                {/* Storage history graph */}
                <motion.div
                  className="dash-history-section"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4, duration: 0.4 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <motion.div
                      className="dash-section-title"
                      style={{ marginBottom: 0 }}
                      animate={{ color: ['var(--text)', 'rgba(196,181,253,0.9)', 'var(--text)'] }}
                      transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
                    >
                      Storage over time
                    </motion.div>
                    <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>
                      {history.length} snapshot{history.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <StorageHistoryChart snaps={history} />
                </motion.div>

                {/* pricing note */}
                <motion.div
                  style={{ padding: '8px 24px', fontSize: 11, color: 'var(--text-faint)', borderTop: '1px solid var(--line)' }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                >
                  Prices in ₹ (1 USD = ₹{USD_TO_INR}) · {data.region} · {pricingSourceLabel(data.pricingSource)} · storage only, excludes requests &amp; data transfer
                  {data.pricingError && ` · pricing fallback reason: ${data.pricingError}`}
                </motion.div>

                {/* bottom tables */}
                <div className="dash-tables">
                  <div className="dash-table-col">
                    <motion.div
                      className="dash-section-title"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.35 }}
                    >
                      Largest files
                    </motion.div>
                    {data.largestFiles.length === 0
                      ? <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>No files.</div>
                      : data.largestFiles.map((f, i) => (
                        <motion.div
                          key={f.key}
                          className="dash-file-row"
                          initial={{ opacity: 0, x: -14 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.4 + i * 0.045, ease: [0.25, 0.46, 0.45, 0.94] }}
                          whileHover={{ backgroundColor: 'rgba(155,92,246,0.07)', x: 2 }}
                        >
                          <motion.span
                            className="dash-file-rank"
                            animate={i === 0 ? { color: ['var(--text-muted)', 'rgba(196,181,253,1)', 'var(--text-muted)'] } : {}}
                            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                          >
                            {i + 1}
                          </motion.span>
                          <span className="dash-file-name" title={f.key}>
                            {f.key.split('/').pop() ?? f.key}
                          </span>
                          <span className="dash-file-size">{formatBytes(f.size)}</span>
                        </motion.div>
                      ))
                    }
                  </div>

                  <div className="dash-table-col">
                    <motion.div
                      className="dash-section-title"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.4 }}
                    >
                      Recently modified
                    </motion.div>
                    {data.recentFiles.length === 0
                      ? <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>No files.</div>
                      : data.recentFiles.map((f, i) => (
                        <motion.div
                          key={f.key}
                          className="dash-file-row"
                          initial={{ opacity: 0, x: 14 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.4 + i * 0.045, ease: [0.25, 0.46, 0.45, 0.94] }}
                          whileHover={{ backgroundColor: 'rgba(155,92,246,0.07)', x: -2 }}
                        >
                          <motion.span
                            className="dash-tier-dot"
                            style={{ background: tierColor(String(f.storageClass)), flexShrink: 0 }}
                            animate={{ scale: [1, 1.5, 1] }}
                            transition={{ duration: 2.5 + i * 0.2, repeat: Infinity, ease: 'easeInOut', delay: i * 0.15 }}
                          />
                          <span className="dash-file-name" title={f.key}>
                            {f.key.split('/').pop() ?? f.key}
                          </span>
                          <span className="dash-file-size">{formatDate(f.lastModified)}</span>
                        </motion.div>
                      ))
                    }
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
};
