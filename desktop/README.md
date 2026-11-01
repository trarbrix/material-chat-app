# Material Chat desktop beta

Electron-based desktop application for Windows x64, macOS Intel and Apple Silicon, and Linux x86-64 (Debian `.deb` and Fedora `.rpm`). The installer bundles Chromium/Electron and the repository's `variant-b.html`; Python or an existing browser is not needed. The desktop icon is based on the same purple icon as the Android build. This is distinct from the lightweight browser-based Linux AppImage in `linux-app/`.

## Build and test

Install Node.js 22.12 or newer and npm. From `desktop/`, run `npm ci` and `npm test`, then one of:

- Windows: `npm run dist:win` — x64 NSIS installer (`.exe`).
- macOS: `npm run dist:mac` — Intel and Apple Silicon disk images (`.dmg`).
- Linux x86-64: `npm run dist:linux` — `.deb` and `.rpm` packages.

Cross-platform installers should be built on their respective OS. Outputs are in `desktop/dist/` (not tracked in Git). Electron and builder tools download platform binaries, so building requires network access. GitHub Actions workflow `.github/workflows/desktop-build.yml` runs all three builds and uploads temporary artifacts; it does **not** publish a GitHub release. Test the downloads on their target systems before publishing.

The beta is **not** code-signed or notarized: Windows SmartScreen and macOS Gatekeeper can warn or prevent opening. Public releases should use a Windows signing certificate and an Apple Developer signing identity plus notarization; keep certificates and credentials out of this repository. No claim of a verified Windows/macOS/Linux GUI, Telegram or production server test is made by the automated build.

## Data and network

The app serves exactly one bundled HTML document on loopback `127.0.0.1:45382` for the lifetime of the app. This preserves a stable browser-storage origin. It is not an API proxy; requests go from Chromium directly to the existing HTTPS server. Server CORS/Cloudflare and other existing backend limitations still apply. The Electron renderer uses its sandbox with Node integration disabled; external links open outside the app. If the port is already occupied, startup fails rather than using another service.

Settings, folders and other browser-local data live in Electron's own user-data directory and are not automatically migrated from a browser, the Linux AppImage or the Android APK. Do not remove an existing app or its profile without backing up data. Shared profiles still require deployment of the separate backend extension.

The updated desktop wrapper requests microphone/camera access only from the bundled page, with a confirmation dialog and the operating system's permission where applicable. Recordings and actual permissions must be verified on each target operating system.
