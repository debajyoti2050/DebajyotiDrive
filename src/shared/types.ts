// Shared types used by both main and renderer processes.
// Keeping these in one place prevents drift between IPC sender and receiver.

export type StorageClass =
  | 'STANDARD'
  | 'INTELLIGENT_TIERING'
  | 'STANDARD_IA'
  | 'ONEZONE_IA'
  | 'GLACIER_IR'        // Glacier Instant Retrieval — millisecond access
  | 'GLACIER'           // Flexible Retrieval — minutes to hours
  | 'DEEP_ARCHIVE';     // Deep Archive — up to 12 hours

export interface StorageClassInfo {
  id: StorageClass;
  label: string;
  blurb: string;
  retrievalTime: string;
  costTier: 1 | 2 | 3 | 4 | 5; // 1 = most expensive storage, 5 = cheapest
  instantRetrieve: boolean;
  minDays: number;
}

// Catalog of storage classes with the trade-offs surfaced in the UI.
// The user picks per upload, so we owe them clear language.
export const STORAGE_CLASSES: StorageClassInfo[] = [
  {
    id: 'STANDARD',
    label: 'Standard',
    blurb: 'Frequently accessed files. Default choice for active work.',
    retrievalTime: 'Instant',
    costTier: 1,
    instantRetrieve: true,
    minDays: 0
  },
  {
    id: 'INTELLIGENT_TIERING',
    label: 'Intelligent-Tiering',
    blurb: 'AWS auto-moves between tiers based on access. Good default for unknown access patterns.',
    retrievalTime: 'Instant (frequent/infrequent tiers)',
    costTier: 2,
    instantRetrieve: true,
    minDays: 0
  },
  {
    id: 'STANDARD_IA',
    label: 'Standard-IA',
    blurb: 'Infrequent access, but needed quickly. Charges per retrieval.',
    retrievalTime: 'Instant',
    costTier: 3,
    instantRetrieve: true,
    minDays: 30
  },
  {
    id: 'ONEZONE_IA',
    label: 'One Zone-IA',
    blurb: 'Cheaper IA but stored in a single AZ. Use for re-creatable data.',
    retrievalTime: 'Instant',
    costTier: 3,
    instantRetrieve: true,
    minDays: 30
  },
  {
    id: 'GLACIER_IR',
    label: 'Glacier Instant Retrieval',
    blurb: 'Archive-grade storage, still millisecond access. Quarterly access pattern.',
    retrievalTime: 'Instant',
    costTier: 4,
    instantRetrieve: true,
    minDays: 90
  },
  {
    id: 'GLACIER',
    label: 'Glacier Flexible Retrieval',
    blurb: 'Long-term archive. Restore takes minutes to hours.',
    retrievalTime: '1 min – 12 hr (depends on tier)',
    costTier: 4,
    instantRetrieve: false,
    minDays: 90
  },
  {
    id: 'DEEP_ARCHIVE',
    label: 'Deep Archive',
    blurb: 'Cheapest. Compliance-grade cold storage. Rare access only.',
    retrievalTime: '12 hr (standard) or 48 hr (bulk)',
    costTier: 5,
    instantRetrieve: false,
    minDays: 180
  }
];

export interface S3Object {
  key: string;
  size: number;
  lastModified: string; // ISO string for IPC serialization
  storageClass: StorageClass | string;
  etag?: string;
  versionId?: string;
  isLatest?: boolean;
}

export interface S3ObjectVersion {
  key: string;
  versionId: string;
  size: number;
  lastModified: string;
  isLatest: boolean;
  storageClass: StorageClass | string;
}

export interface AppConfig {
  region: string;
  bucket: string;
  // Credentials live in ~/.aws/credentials by default (we use the AWS shared config provider).
  // Optionally a named profile to switch identities.
  profile?: string;
}

export interface MultiConfig {
  buckets: AppConfig[];
  activeIndex: number;
}

export interface UploadRequest {
  localPath: string;
  key: string;
  storageClass: StorageClass;
}

export interface UploadProgress {
  key: string;
  loaded: number;
  total: number;
  done: boolean;
  error?: string;
}

export interface RestoreRequest {
  key: string;
  versionId?: string;
  days: number;            // How long the restored copy stays accessible
  tier: 'Standard' | 'Bulk' | 'Expedited';
}

export interface TierStats {
  storageClass: string;
  count: number;
  totalBytes: number;
  estimatedMonthlyCost: number; // USD, storage only, us-east-1 rates
}

export interface BucketAnalytics {
  totalObjects: number;
  totalBytes: number;
  estimatedMonthlyCost: number;
  byTier: TierStats[];           // sorted by totalBytes desc
  largestFiles: S3Object[];      // top 10
  recentFiles: S3Object[];       // top 10 by lastModified
  scannedAt: string;             // ISO
  capped: boolean;               // true if scan hit the 50k object limit
  region: string;                // region whose pricing was used
}

// Result wrapper so the renderer can render errors instead of throwing.
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
