# Windows Installer Signing

Windows shows "Unknown publisher" or SmartScreen warnings when the `.exe` installer is not signed by a trusted Authenticode certificate. The app is now configured for Windows code signing through `electron-builder`, but a real OV or EV code-signing certificate is still required for Windows to trust the publisher.

## Required certificate

Use an Authenticode code-signing certificate issued to the publisher name `Debajyoti` or your registered company name.

- OV certificate: removes "Unknown publisher" after signing, but SmartScreen reputation builds over time.
- EV certificate: strongest option for launch; usually earns SmartScreen reputation faster.

## Build environment

Set the certificate location and password before packaging:

```powershell
$env:CSC_LINK="D:\certs\debajyoti-drive.pfx"
$env:CSC_KEY_PASSWORD="your-pfx-password"
npm run package
```

`CSC_LINK` can also be a base64-encoded `.pfx` value in CI. Do not commit the certificate or password to the repo.

## Verify the installer

After packaging, verify the generated installer:

```powershell
Get-AuthenticodeSignature "release\Debajyoti Drive Setup 0.1.0.exe"
```

The expected result is `Status : Valid` with the correct signer certificate. If the status is `NotSigned`, Windows will continue showing unknown-publisher warnings.

## Important note

Code signing fixes the publisher identity problem. SmartScreen reputation is controlled by Microsoft and may still warn for a newly signed app until the certificate or app gains enough reputation, especially with an OV certificate.
