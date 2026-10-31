# Material Chat for Linux

The x86-64 AppImage bundles the HTML, icon, launcher and AppImage runtime. It is a lightweight browser-based desktop wrapper, **not** a bundled browser: it requires Python 3.7 or newer and an installed Chromium, Google Chrome, Brave, or Microsoft Edge. It runs the browser in an app window with a separate profile. AppImage normally needs FUSE; alternatively use `--appimage-extract-and-run`.

The launcher serves the bundled HTML on `127.0.0.1:45381` only while the app is running. This gives the app a stable local origin for browser storage. It serves no API and accepts no file paths. API requests go directly from the browser to the existing HTTPS server, subject to server CORS and Cloudflare. It does not bypass browser security or use `--no-sandbox`. Only one instance may run at a time; if the port is occupied, startup fails instead of opening a different service. Your local browser data is stored under `${XDG_DATA_HOME:-~/.local/share}/material-chat/<browser>/`; if the selected browser changes, its profile is separate. Do not delete these profiles without backing up data.

## Run

```sh
chmod +x Material-Chat-x86_64.AppImage
./Material-Chat-x86_64.AppImage
# If FUSE is unavailable:
./Material-Chat-x86_64.AppImage --appimage-extract-and-run
```

## Build

Use Linux x86-64 with `mksquashfs` (squashfs-tools 4.x), plus an x86-64 [AppImage Type-2 runtime](https://github.com/AppImage/type2-runtime). From the repo root:

```sh
RUNTIME_X86_64=/path/to/runtime-x86_64 ./linux-app/build.sh
```

The distributed beta uses the AppImage Type-2 runtime release `20251108`, SHA-256 `2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d`, as vendored by the Deno repository; its MIT license is included in the image. HTML and icon are taken directly from this repository. No binary browser is included. This build has not been tested in a real desktop session; login and messaging depend on the remote server.
