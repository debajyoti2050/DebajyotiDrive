<div align="center">
  <img src="assets/logo.svg" alt="S3Drive" width="480" />
  <br/>
  <p><strong>A Google Drive-style desktop client for Amazon S3.</strong><br/>
  Pay-as-you-go cloud storage with Drive-like UX and S3 economics.</p>

  ![License](https://img.shields.io/badge/license-MIT-green)
  ![Version](https://img.shields.io/badge/version-0.1.0-blue)
  ![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
</div>

---

## What is S3Drive?

S3Drive is a desktop app that gives you a Google Drive-style interface over any S3 bucket. Browse, upload, share, preview, and archive — all from a local client that stores credentials on your machine, not on any server.

**If you're looking for:** a "Google Drive alternative", "pay-as-you-go cloud drive", or "self-hosted cloud storage" — S3Drive is built for exactly that.

---

## Quick Start

### Option A — Download the installer (recommended)

1. Grab the latest release for your platform from the [Releases](../../releases) page
2. Install and launch S3Drive
3. Click the **⚙ Settings** icon → enter your bucket name, region, and AWS credentials → **Save & connect**

That's it — no terminal, no config files required.

---

### Option B — Run from source

**Prerequisites:** Node.js 20+ and npm

```bash
# 1. Clone and install
git clone <repo-url>
cd s3drive
npm install

# 2. Start the dev server
npm run dev
```

On first launch, the Settings dialog opens automatically. Enter your bucket name, region, and AWS credentials — they're saved locally in your app data folder.

---

## Setting up AWS credentials

You have three ways to authenticate — enter whichever you prefer in the **Settings** dialog:

### 1. Access Key ID + Secret (simplest)

Enter your `Access Key ID` and `Secret Access Key` directly in the Settings form. They're stored in your app data folder (`%APPDATA%\S3Drive\config.json` on Windows, `~/.config/S3Drive/` on Linux, `~/Library/Application Support/S3Drive/` on macOS) — never sent anywhere else.

To create a key pair:
1. Open the [AWS IAM Console](https://console.aws.amazon.com/iam/) → **Users** → your user
2. **Security credentials** tab → **Create access key**
3. Copy the Access Key ID and Secret Access Key into S3Drive Settings

### 2. Named AWS profile

If you already use the AWS CLI, leave the key fields blank and enter a profile name (e.g. `default` or `work`). S3Drive reads `~/.aws/credentials`.

```bash
aws configure --profile s3drive
# then enter "s3drive" in the Profile field in Settings
```

### 3. Environment variables

Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` before launching. Leave all credential fields in Settings blank.

---

## Creating your S3 bucket

1. Go to the [AWS S3 Console](https://s3.console.aws.amazon.com) → **Create bucket**
2. Choose a globally unique name and a region close to you
3. Leave all other defaults (Block Public Access stays on — S3Drive uses pre-signed URLs for sharing, no public bucket required)
4. Enter the bucket name and region in S3Drive Settings

---

## IAM policy

The credentials you provide need these S3 permissions. Replace `YOUR-BUCKET` with your bucket name.

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

---

## Features

| Feature | Details |
|---|---|
| **Browse** | Folder-like navigation over S3 key prefixes |
| **Upload** | Per-file storage class selection, multipart progress |
| **Download** | Archive-tier warnings; restore prompts for Glacier |
| **Preview** | Images and PDFs inline via short-lived pre-signed URLs |
| **Share** | Pre-signed links with configurable expiry (15 min → 7 days) |
| **Versioning** | List, download, restore, or delete specific versions |
| **Archive restore** | Glacier / Deep Archive restore with Bulk / Standard / Expedited tiers |
| **Search** | Client-side search across all objects (capped at 500 matches) |
| **Change storage class** | Move objects between tiers via copy-in-place |
| **Multi-bucket** | Save and switch between multiple bucket configurations |

---

## Storage class reference

| Class | Retrieval | Min billed | Best for |
|---|---|---|---|
| Standard | Instant | — | Active files |
| Intelligent-Tiering | Instant | — | Unknown access patterns |
| Standard-IA | Instant (fee) | 30 days | Backups, old projects |
| One Zone-IA | Instant (fee) | 30 days | Re-creatable data |
| Glacier Instant | Instant (higher fee) | 90 days | Quarterly archives |
| Glacier Flexible | 1 min – 12 hr | 90 days | Compliance archives |
| Deep Archive | 12 – 48 hr | 180 days | Cold compliance archives |

> **Gotcha:** IA tiers have a 30-day minimum billing period per object, and objects under 128 KB are billed as 128 KB. For lots of small or short-lived files, Standard or Intelligent-Tiering is cheaper.

---

## Build for distribution

### Automated releases (recommended)

Push a version tag and GitHub Actions builds both installers automatically:

```bash
git tag v1.0.0
git push origin v1.0.0
```

A GitHub Release is created with:
- `S3Drive-1.0.0.dmg` — macOS (universal: Intel + Apple Silicon)
- `S3Drive Setup 1.0.0.exe` — Windows installer

### Local build

```bash
npm run build      # compile TypeScript (main + renderer)
npm run package    # produce installer via electron-builder → release/
```

---

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
│  • ConfigStore — JSON in userData (credentials included) │
│  • S3Service — AWS SDK v3 wrapper                        │
│    ├─ @aws-sdk/client-s3         (commands)              │
│    ├─ @aws-sdk/lib-storage       (multipart upload)      │
│    ├─ @aws-sdk/s3-request-presigner  (share URLs)        │
│    └─ @aws-sdk/credential-providers  (profile fallback)  │
└──────────────────────────────────────────────────────────┘
```

**Security:** `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`. Credentials are loaded once in the main process and never cross the IPC boundary. Pre-signed URLs are generated in main and passed to the renderer as opaque strings.

---

## Project layout

```
s3drive/
├── assets/                    # logo, icons
├── src/
│   ├── shared/types.ts        # IPC contract + storage class catalog
│   ├── main/
│   │   ├── index.ts           # window creation + IPC handlers
│   │   ├── s3Service.ts       # AWS SDK v3 wrapper
│   │   └── configStore.ts     # multi-bucket JSON config (userData)
│   ├── preload/
│   │   ├── index.ts           # contextBridge surface
│   │   └── types.d.ts         # window.s3drive typing
│   └── renderer/
│       ├── App.tsx            # shell + routing
│       ├── SettingsModal.tsx  # bucket + credential management
│       ├── UploadModal.tsx
│       ├── ShareModal.tsx
│       ├── VersionsModal.tsx
│       ├── PreviewModal.tsx
│       ├── AWSStatusModal.tsx # region map
│       └── styles.css
```

---

## License

MIT © Debajyoti
