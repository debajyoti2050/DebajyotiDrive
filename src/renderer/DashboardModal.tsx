import React, { useEffect, useState } from 'react';
import type { BucketAnalytics, TierStats } from '@shared/types';
import { STORAGE_CLASSES } from '@shared/types';
import { formatBytes, formatDate } from './utils';

interface Props {
  onClose: () => void;
  onToast: (msg: string, kind?: 'info' | 'error' | 'success') => void;
}

// 1 USD ≈ 84 INR (approximate; update periodically)
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

function tierColor(sc: string): string {
  const info = STORAGE_CLASSES.find(c => c.id === sc);
  const tier = info?.costTier ?? 1;
  return `var(--tier-${tier})`;
}

function tierLabel(sc: string): string {
  return STORAGE_CLASSES.find(c => c.id === sc)?.label ?? sc;
}

// ── donut chart ───────────────────────────────────────────────────────────────

interface DonutSlice { color: string; fraction: number; label: string; bytes: number }

function DonutChart({ slices }: { slices: DonutSlice[] }) {
  const cx = 100, cy = 100, R = 80, r = 50;
  let angle = -Math.PI / 2;
  const paths: React.ReactNode[] = [];

  for (const s of slices) {
    if (s.fraction <= 0) continue;
    const sweep = s.fraction * 2 * Math.PI;
    const end   = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;

    const x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle);
    const x2 = cx + R * Math.cos(end),   y2 = cy + R * Math.sin(end);
    const x3 = cx + r * Math.cos(end),   y3 = cy + r * Math.sin(end);
    const x4 = cx + r * Math.cos(angle), y4 = cy + r * Math.sin(angle);

    paths.push(
      <path
        key={s.label}
        d={`M${x1} ${y1} A${R} ${R} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${r} ${r} 0 ${large} 0 ${x4} ${y4}Z`}
        fill={s.color}
        stroke="var(--bg-elev)"
        strokeWidth="2"
      >
        <title>{s.label}: {formatBytes(s.bytes)}</title>
      </path>
    );
    angle = end;
  }

  return (
    <svg viewBox="0 0 200 200" width="160" height="160" style={{ display: 'block' }}>
      {paths}
      <text x="100" y="95"  textAnchor="middle" fill="var(--text-faint)" fontSize="9" fontFamily="inherit" letterSpacing="0.08em">STORAGE</text>
      <text x="100" y="110" textAnchor="middle" fill="var(--text)"       fontSize="9" fontFamily="inherit" letterSpacing="0.08em">BY TIER</text>
    </svg>
  );
}

// ── stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="dash-stat-card">
      <div className="dash-stat-label">{label}</div>
      <div className="dash-stat-value">{value}</div>
      {sub && <div className="dash-stat-sub">{sub}</div>}
    </div>
  );
}

// ── tier bar row ──────────────────────────────────────────────────────────────

function TierRow({ t, maxBytes }: { t: TierStats; maxBytes: number }) {
  const pct = maxBytes > 0 ? (t.totalBytes / maxBytes) * 100 : 0;
  const color = tierColor(t.storageClass);
  return (
    <div className="dash-tier-row">
      <div className="dash-tier-name">
        <span className="dash-tier-dot" style={{ background: color }} />
        {tierLabel(t.storageClass)}
      </div>
      <div className="dash-tier-bar-wrap">
        <div className="dash-tier-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="dash-tier-meta">
        <span>{formatBytes(t.totalBytes)}</span>
        <span className="dash-tier-count">{t.count.toLocaleString()} obj</span>
        <span className="dash-tier-cost" title={formatUSD(t.estimatedMonthlyCost) + '/mo'}>
          {formatINR(t.estimatedMonthlyCost)}/mo
        </span>
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export const DashboardModal: React.FC<Props> = ({ onClose, onToast }) => {
  const [data, setData]       = useState<BucketAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);

  const scan = async () => {
    setLoading(true);
    const res = await window.s3drive.s3.analytics();
    setLoading(false);
    setScanned(true);
    if (!res.ok) { onToast(res.error, 'error'); return; }
    setData(res.value);
    if (res.value.capped) {
      onToast('Scan capped at 50 000 objects — totals are partial.', 'info');
    }
  };

  useEffect(() => { scan(); }, []);

  const donutSlices: DonutSlice[] = (data?.byTier ?? []).map(t => ({
    color:    tierColor(t.storageClass),
    fraction: data!.totalBytes > 0 ? t.totalBytes / data!.totalBytes : 0,
    label:    tierLabel(t.storageClass),
    bytes:    t.totalBytes
  }));

  const maxTierBytes = data?.byTier[0]?.totalBytes ?? 1;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal dash-modal"
        onClick={e => e.stopPropagation()}
        style={{ width: 880 }}
      >
        {/* header */}
        <div className="modal-header">
          <div className="modal-title">
            Bucket analytics
            {data && (
              <span className="dash-scan-time">
                {data.region} · scanned {formatDate(data.scannedAt)}
                {data.capped && ' · partial (50k cap)'}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={scan} disabled={loading}>
              {loading ? 'Scanning…' : '↺ Rescan'}
            </button>
            <button className="modal-close" onClick={onClose}>esc</button>
          </div>
        </div>

        <div className="modal-body" style={{ padding: 0 }}>
          {loading && !data && (
            <div className="dash-loading">
              <div className="dash-spinner" />
              <span>Scanning bucket…</span>
            </div>
          )}

          {!loading && !scanned && (
            <div className="dash-loading">
              <button className="btn primary" onClick={scan}>Scan bucket</button>
            </div>
          )}

          {data && (
            <div className="dash-body">
              {/* stat cards */}
              <div className="dash-cards">
                <StatCard
                  label="Total objects"
                  value={data.totalObjects.toLocaleString()}
                  sub={data.capped ? 'partial scan' : `${data.byTier.length} tier(s)`}
                />
                <StatCard
                  label="Storage used"
                  value={formatBytes(data.totalBytes)}
                  sub={`${(data.totalBytes / 1024 ** 3).toFixed(2)} GB`}
                />
                <StatCard
                  label="Est. monthly cost"
                  value={formatINR(data.estimatedMonthlyCost)}
                  sub={`${formatUSD(data.estimatedMonthlyCost)} · ${data.region}`}
                />
                <StatCard
                  label="Est. annual cost"
                  value={formatINR(data.estimatedMonthlyCost * 12)}
                  sub={`${formatUSD(data.estimatedMonthlyCost * 12)} · projection`}
                />
              </div>

              {/* tier breakdown + donut */}
              <div className="dash-mid">
                <div className="dash-tiers">
                  <div className="dash-section-title">Storage by tier</div>
                  {data.byTier.length === 0 && (
                    <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>No objects found.</div>
                  )}
                  {data.byTier.map(t => (
                    <TierRow key={t.storageClass} t={t} maxBytes={maxTierBytes} />
                  ))}
                </div>

                <div className="dash-donut-wrap">
                  <div className="dash-section-title">Distribution</div>
                  {data.byTier.length > 0
                    ? <DonutChart slices={donutSlices} />
                    : <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>No data.</div>
                  }
                  <div className="dash-legend">
                    {data.byTier.map(t => (
                      <div key={t.storageClass} className="dash-legend-row">
                        <span className="dash-tier-dot" style={{ background: tierColor(t.storageClass) }} />
                        <span>{tierLabel(t.storageClass)}</span>
                        <span style={{ color: 'var(--text-faint)' }}>
                          {data.totalBytes > 0
                            ? `${((t.totalBytes / data.totalBytes) * 100).toFixed(1)}%`
                            : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* pricing note */}
              <div style={{ padding: '8px 24px', fontSize: 11, color: 'var(--text-faint)', borderTop: '1px solid var(--line)' }}>
                Prices in ₹ (1 USD = ₹{USD_TO_INR}) · {data.region} storage rates · storage cost only, excludes requests & data transfer
              </div>

              {/* bottom tables */}
              <div className="dash-tables">
                <div className="dash-table-col">
                  <div className="dash-section-title">Largest files</div>
                  {data.largestFiles.length === 0
                    ? <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>No files.</div>
                    : data.largestFiles.map((f, i) => (
                      <div key={f.key} className="dash-file-row">
                        <span className="dash-file-rank">{i + 1}</span>
                        <span className="dash-file-name" title={f.key}>
                          {f.key.split('/').pop() ?? f.key}
                        </span>
                        <span className="dash-file-size">{formatBytes(f.size)}</span>
                      </div>
                    ))
                  }
                </div>

                <div className="dash-table-col">
                  <div className="dash-section-title">Recently modified</div>
                  {data.recentFiles.length === 0
                    ? <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>No files.</div>
                    : data.recentFiles.map(f => (
                      <div key={f.key} className="dash-file-row">
                        <span
                          className="dash-tier-dot"
                          style={{ background: tierColor(String(f.storageClass)), flexShrink: 0 }}
                        />
                        <span className="dash-file-name" title={f.key}>
                          {f.key.split('/').pop() ?? f.key}
                        </span>
                        <span className="dash-file-size">{formatDate(f.lastModified)}</span>
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
