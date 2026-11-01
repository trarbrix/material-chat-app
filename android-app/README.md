# Material Chat for Android

The Android application wraps the repository's `variant-b.html` in a WebView. Its icon is the original embedded purple image. It uses an HTTPS app-assets origin, JavaScript and DOM storage, and Android's document picker for wallpaper, avatar and attachment inputs. External links open in another app. Network requests use the existing HTTPS server; server CORS, Cloudflare and deployment limitations still apply.

## Build

Open `android-app` in Android Studio, install Android SDK Platform 35, and build the `app` module. Android Gradle Plugin 8.6.1 requires JDK 17 and Gradle 8.7. `assembleDebug` produces `app/build/outputs/apk/debug/app-debug.apk`; the build copies `../variant-b.html` into its generated assets. For a distributable build, configure a private release signing key in Android Studio, store it safely outside the repository, and build a signed APK. Never commit the keystore or passwords.

Package ID is `app.materialchat.variantb`, minimum Android 8 (API 26), target API 32; this is a separate application from any differently named existing package. WebView/Chrome should be up to date. Existing browser or other app local storage does not migrate automatically. APK updates require the exact same package ID and signing key. The shipped beta is signed with a separate locally generated key, not Android Studio's default debug key; a locally built APK cannot update it unless signed with that same key. Keep signing keys backed up securely; do not uninstall an existing app without backing up its data.

No Android emulator or device was available for this build. Installation, file picker, UI and live server connectivity need a device test. A server challenge or missing server features cannot be fixed by the wrapper alone.

The beta was assembled in the workspace using Android build tools (rather than Gradle) and signed with a locally generated private key kept outside Git in `/home/user/.material-chat-signing/`. Preserve that directory securely if future beta updates must be signed with the same identity; it is not included in the repository. The Android Studio build procedure above is a source-based alternative and is not guaranteed to be byte-for-byte identical.

The updated wrapper requests microphone and camera permissions only for the bundled app origin and only when a recording is requested. Rebuild the APK to include these changes. An update to the existing beta APK requires its original signing key; do not uninstall the previous app without backing up its local data.
