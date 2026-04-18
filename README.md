# S3Drive

A Drive-like desktop client for Amazon S3, built with Electron + React + TypeScript + AWS SDK v3. Per-upload storage class control, inline previews, pre-signed URL sharing, versioning with restore, and search.

## Why this exists

Google Drive is great UX, lousy economics at scale. S3 is the opposite. S3Drive is a thin, honest client that puts S3's economics behind a Drive-flavored UI — and exposes storage classes as a first-class choice, not a hidden lifecycle policy.

## Feature set

- **Browse** by prefix (S3 has no real folders; `/`-delimited keys are treated as folders)
- **Upload** with per-upload storage class selection and progress bars
- **Download** with archive-tier warnings (Glacier/Deep Archive need restore first)
- **Preview** images and PDFs inline via short-lived pre-signed URLs
- **Share** with pre-signed URLs (15 min → 7 days expiry)
- **Versioning** — list all versions, download any, restore old versions, delete specific versions
- **Archive restore** — initiate Glacier/Deep Archive restore with Bulk/Standard/Expedited tiers
- **Search** across all objects in the bucket (client-side, capped at 500 matches for v1)
- **Change storage class** of existing objects via copy-in-place

## Prerequisites

1. **Node.js 20+** and npm
2. **An AWS account** with an S3 bucket already created
3. **AWS credentials** configured in `~/.aws/credentials` (see the IAM section below)

### Install

```bash
npm install
```

### Dev

```bash
npm run dev
```

Starts Vite for the renderer on `localhost:5173` and launches Electron once it's ready.

### Build

```bash
npm run build          # compile main + renderer
npm run package        # produce installer via electron-builder
```

## Credentials: how and where

**S3Drive does not collect your AWS access keys.** It uses the AWS SDK's default credential provider chain, which reads (in order):

1. Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
2. `~/.aws/credentials` (optionally a named profile)
3. EC2/ECS instance metadata (irrelevant on desktop)

To set up credentials:

```bash
aws configure                       # default profile
# or
aws configure --profile s3drive     # named profile (then enter "s3drive" in Settings)
```

Only the **bucket name**, **region**, and **optional profile name** are stored by the app, in `~/Library/Application Support/S3Drive/config.json` (macOS) / `%APPDATA%/S3Drive/` (Windows) / `~/.config/S3Drive/` (Linux).

## IAM policy

The IAM user / role your credentials point to needs these permissions on the bucket. Replace `YOUR-BUCKET` with your bucket name.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3DriveBucketOps",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:ListBucketVersions",
        "s3:GetBucketVersioning",
        "s3:PutBucketVersioning"
      ],
      "Resource": "arn:aws:s3:::YOUR-BUCKET"
    },
    {
      "Sid": "S3DriveObjectOps",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:GetObjectVersion",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:DeleteObjectVersion",
        "s3:RestoreObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": "arn:aws:s3:::YOUR-BUCKET/*"
    }
  ]
}
```

If you plan to let end-users have their own IAM users (e.g. in a team deployment), scope `Resource` to `arn:aws:s3:::YOUR-BUCKET/${aws:username}/*` so each user only sees their own prefix.

## CORS

If you use the inline preview feature, S3 must allow your app to fetch presigned URLs. Electron's renderer uses `file://` origins, which S3 treats permissively for presigned GET requests — usually no CORS config is needed for this app's preview flow. If you hit issues, add a minimal CORS rule:

```json
[
  {
    "AllowedMethods": ["GET"],
    "AllowedOrigins": ["*"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3000
  }
]
```

## Storage class quick reference

| Class | Retrieve | Min billed days | Best for |
|---|---|---|---|
| Standard | instant | 0 | Active work |
| Intelligent-Tiering | instant | 0 | Unknown access patterns (good default) |
| Standard-IA | instant (retrieval fee) | 30 | Backups, old projects |
| One Zone-IA | instant (retrieval fee) | 30 | Re-creatable data |
| Glacier Instant Retrieval | instant (higher retrieval fee) | 90 | Quarterly-access archives |
| Glacier Flexible Retrieval | 1 min – 12 hr | 90 | Compliance archives |
| Deep Archive | 12 – 48 hr | 180 | Cold compliance archives |

**Gotchas:**
- IA tiers bill a **minimum of 30 days** per object — uploading lots of small short-lived files to IA costs *more* than Standard
- Small objects (<128 KB) in IA/Glacier still bill as if they were 128 KB — another reason Intelligent-Tiering is often the right default
- `GLACIER` and `DEEP_ARCHIVE` objects **cannot be downloaded directly** — you must initiate a restore first (the app will nudge you to the Versions dialog where this lives)

## Versioning

Click **"Enable versioning"** in the sidebar once per bucket. After that:

- Every upload of an existing key creates a new version (the old one stays as a historical version)
- Deletes create a **delete marker** (recoverable) instead of actually deleting
- To truly purge, open **Versions** on a file and delete specific version IDs (including delete markers)

Versioning has a cost: you pay for every version's storage. Pair it with a **lifecycle rule** in the AWS console to auto-expire old versions (e.g. "transition noncurrent versions to Glacier after 30 days, delete after 365") — this is not exposed in the app yet but is a good next feature.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Renderer (React + Vite)                                 │
│  sandboxed, contextIsolated — no direct Node/AWS access  │
└──────────────────────┬───────────────────────────────────┘
                       │ window.s3drive.* (contextBridge)
┌──────────────────────▼───────────────────────────────────┐
│  Preload (src/preload/index.ts)                          │
│  typed IPC surface, one function per action              │
└──────────────────────┬───────────────────────────────────┘
                       │ ipcRenderer.invoke
┌──────────────────────▼───────────────────────────────────┐
│  Main process (Electron)                                 │
│  • ConfigStore — JSON in userData                        │
│  • S3Service — AWS SDK v3 wrapper                        │
│    ├─ @aws-sdk/client-s3         (commands)              │
│    ├─ @aws-sdk/lib-storage       (multipart upload)      │
│    ├─ @aws-sdk/s3-request-presigner  (share URLs)        │
│    └─ @aws-sdk/credential-providers   (~/.aws/credentials)│
└──────────────────────────────────────────────────────────┘
```

**Security posture:**
- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
- Renderer has zero Node / AWS SDK access — every S3 operation goes through the typed preload bridge
- Credentials are loaded once in the main process and never cross the IPC boundary
- Pre-signed URLs are generated in the main process and handed to the renderer as strings

## Known limitations / v2 ideas

- **Search is client-side.** Good for thousands of objects, not for millions. For real scale, plug in S3 Inventory + Athena or OpenSearch.
- **No folder sync daemon.** This is a browser, not a sync client. Adding a chokidar-based watcher on a local folder is maybe ~200 lines but significantly more state to get right.
- **No drag-and-drop upload yet.** Trivial to add: listen for `ondrop` on the content pane, read `dataTransfer.files`, and pipe into the existing upload flow.
- **No lifecycle-policy editor.** Would be a natural fit — let users set "auto-transition to Glacier after N days" from the UI instead of the AWS console.
- **No multi-bucket switcher.** You'd configure multiple buckets and toggle between them in the titlebar. Straightforward extension of `ConfigStore`.
- **No thumbnails.** Generating thumbnails at scale means either a Lambda on PUT or doing it client-side and storing under a `.thumbs/` prefix.

## Project layout

```
s3drive/
├── package.json
├── tsconfig.json              # renderer (ESM + JSX)
├── tsconfig.main.json         # main + preload (CommonJS)
├── vite.config.ts
└── src/
    ├── shared/
    │   └── types.ts           # IPC contract + storage class catalog
    ├── main/
    │   ├── index.ts           # window + IPC handlers
    │   ├── s3Service.ts       # AWS SDK wrapper
    │   └── configStore.ts     # JSON config persistence
    ├── preload/
    │   ├── index.ts           # contextBridge surface
    │   └── types.d.ts         # window.s3drive typing
    └── renderer/
        ├── index.html
        ├── main.tsx
        ├── App.tsx            # shell
        ├── SettingsModal.tsx
        ├── UploadModal.tsx
        ├── ShareModal.tsx
        ├── VersionsModal.tsx
        ├── PreviewModal.tsx
        ├── utils.ts
        └── styles.css         # utility-brutalist design system
```

## License

MIT
