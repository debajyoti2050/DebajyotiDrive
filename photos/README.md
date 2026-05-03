# Debajyoti Photos

Debajyoti Photos is a separate Expo iOS/Android app inside this repository. It backs up selected photos and videos to S3 using a small presign API, so AWS credentials never ship inside the mobile app.

## What Is Included

- `App.tsx` - production-focused Photos and Upload screens.
- `server/index.mjs` - S3 presign API for listing and uploading media.
- `app.json` - mobile app identity, permissions, and bundle ids.

There is intentionally no Albums screen in this build.

## Environment

The API automatically loads AWS credentials from the original project root `.env` first:

- `../.env`

That means the existing `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from the desktop project are reused without copying or exposing them.

Photos-specific settings should live in `photos/.env.local` or the deployment environment:

```powershell
AWS_REGION=ap-south-1
PHOTOS_S3_BUCKET=your-bucket-name
PHOTOS_S3_PREFIX=debajyoti-photos/
PHOTOS_API_TOKEN=change-this-long-random-token
PHOTOS_ALLOWED_ORIGIN=*
EXPO_PUBLIC_PHOTOS_API_URL=http://localhost:8787
EXPO_PUBLIC_PHOTOS_API_TOKEN=change-this-long-random-token
```

For a physical phone, set `EXPO_PUBLIC_PHOTOS_API_URL` to your computer LAN address before starting Expo.

## Run Locally

Start the API:

```powershell
npm run api
```

Start Expo:

```powershell
npm start
```

For Android:

```powershell
npm run android
```

For iOS, use `npm run ios` on macOS or scan the Expo QR with Expo Go.

## Production Notes

- Deploy `server/index.mjs` behind HTTPS.
- Set `PHOTOS_API_TOKEN` and match it with `EXPO_PUBLIC_PHOTOS_API_TOKEN`.
- Use an IAM user or role scoped to only the target bucket/prefix.
- Keep `PHOTOS_PRESIGN_SECONDS` short. The default is 300 seconds.
- For app store builds, use EAS Build and set env vars through EAS secrets or your CI/CD system.
