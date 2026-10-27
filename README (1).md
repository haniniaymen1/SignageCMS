# SignageCMS

**Digital Signage Content Management System** — manage your screens, publish content, schedule campaigns, and monitor playback from a single web interface.

| | |
|---|---|
| **Server version** | 3.11.13 |
| **Android player** | 3.3 (recommended) |
| **Stack** | Next.js 16 (App Router) · React 19 · Prisma 6 · SQLite |
| **License** | Proprietary — all rights reserved |

---

## Overview

SignageCMS is a complete, self-hosted digital signage solution. It turns any screen connected to a browser or an Android device into a managed display. Content is organized into media, playlists, layouts (multi-zone pages) and campaigns; campaigns are scheduled through time-window events and played by a web player or the native Android player.

Everything runs from a single Node.js server with an embedded SQLite database — no external database server is required. PowerPoint and PDF documents are automatically converted to per-slide images by LibreOffice and Poppler, so presentations play reliably on low-power players.

## Features

- **Dashboard & monitoring** — live display status, heartbeats, playback statistics, event logs and proof-of-play reports.
- **Displays** — register screens with hardware keys, group them (DisplayGroups), connect Android players via QR code.
- **Media library** — images, videos, audio, PDF, PowerPoint (PPT/PPTX/PPS/PPSX/ODP), web pages and IPTV streams. Large files supported (configurable upload limit); failed PPT/PDF conversions can be re-triggered with one click.
- **Layouts & regions** — multi-zone page designer with resizable regions and widgets: clock, weather, RSS feed, text, image, video, presentation, PDF, IPTV stream, web page.
- **Playlists & campaigns** — sequence content into playlists, assemble layouts into campaigns with per-page durations. Loop ON repeats the campaign; loop OFF (v3.11.12) plays it exactly once, respecting each duration, then moves on to the next event or the standby clock screen.
- **Scheduling** — time-window schedule events targeting displays or display groups; a campaign can be reused across many events.
- **Users & security** — local accounts, fine-grained permissions, user groups, LDAP/Active Directory import, JWT sessions, SSRF protection for web content, anti-clickjacking (configurable).
- **IPTV** — Xtream Codes multi-account portal and M3U playlists (URL or file), channel browsing, proxy streaming through the server.
- **Players** — full-screen web player (`/player`) for any browser, plus a hardened Android APK player.

## Archive contents

```
signagecms/
├── src/                  Application source (App Router, API routes, CMS UI)
├── prisma/               Database schema (SQLite)
├── public/               Static assets, favicon, logo
├── deploy/
│   ├── linux/            install.sh · start.sh · install-tools.sh · LISEZMOI.txt
│   └── windows/          install.bat · install.ps1 · start-cms.bat · build.bat · ...
├── scripts/              Utility scripts (seed, maintenance, tests)
├── tests/                Integration test harnesses
├── package.json          Dependencies and build scripts
└── VERSION               Server version (3.11.13)
```

## Requirements

| Component | Requirement |
|---|---|
| Operating system | Linux (Ubuntu/Debian, RHEL/Fedora, openSUSE, Arch, Alpine) or Windows 10/11, Server 2016+ |
| Node.js | 20 LTS or newer |
| RAM | 2 GB minimum (4 GB recommended for the production build) |
| Disk | 2 GB + space for media |
| Optional | LibreOffice + Poppler (PowerPoint/PDF conversion) |

## Quick start

### Linux — one-command installation (recommended)

```bash
sudo bash deploy/linux/install.sh --zip /path/to/SignageCMS-Serveur-v3.11.13.zip
```

The script is **idempotent** and performs 8 steps: base utilities → Node.js 20 LTS → LibreOffice + Poppler → deployment to `/opt/signagecms` → `.env` (never overwrites an existing one) → `npm install` + Prisma + production build → systemd service (auto-start, crash restart) → firewall rule + final API check.

Useful options:

```bash
--port 8080          # listen port (default 3000)
--dir /opt/mycms     # installation directory (default /opt/signagecms)
--no-service         # skip the systemd service
--no-firewall        # do not touch the firewall
```

Without `sudo`, the script degrades gracefully: system steps (packages, systemd, firewall) are skipped with clear messages and the installation proceeds as soon as the target directory is writable.

### Linux — start / stop / status

```bash
bash deploy/linux/start.sh              # foreground (Ctrl+C to stop)
bash deploy/linux/start.sh --daemon     # background (service.log + server.pid)
bash deploy/linux/start.sh --status     # process state + API version
bash deploy/linux/start.sh --restart    # restart background instance
bash deploy/linux/start.sh --stop       # stop background instance
```

If the systemd service was created by `install.sh`, prefer `sudo systemctl status|restart|stop signagecms`.

### Windows

Run `deploy\windows\install.bat` (assisted installation: Node.js check, `.env`, dependencies, Prisma, production build) then `deploy\windows\start-cms.bat`. Advanced scripts: `install.ps1`, `install-service.ps1` (Windows service), `firewall.ps1`, `build.bat`.

### Manual installation (any OS)

```bash
npm install
npx prisma db push && npx prisma generate
npm run build            # production build (standalone output)
node .next/standalone/server.js
```

Create a `.env` file first — see [Configuration](#configuration).

## First login

On the very first start, the **admin account is created automatically** with a random password. The password is:

1. written to `db/admin-credentials.txt` (delete this file after your first login), and
2. printed in the server console.

Then open `http://<server-ip>:3000`, log in as `admin`, and **change the password immediately** (Settings). Register your first display from the *Displays* page (hardware key) or scan the QR code with the Android player.

## Configuration

All settings live in the `.env` file at the project root. `install.sh` and `install.bat` create it automatically and never overwrite an existing one.

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `file:<abs-path>/db/custom.db` | SQLite database (absolute path, forward slashes) |
| `PORT` | `3000` | HTTP listen port |
| `ALLOW_FRAME_EMBED` | unset | Set to `1` to allow embedding the CMS UI in external iframes. `/player` is always embeddable. |
| `MAX_UPLOAD_MB` | UI setting | Upload size limit in MB (overrides the Settings UI value) |
| `SOFFICE_PATH` | auto-detected | Full path to the LibreOffice binary (`soffice`) |
| `PDFTOPPM_PATH` | auto-detected | Full path to the Poppler binary (`pdftoppm`) |

## PowerPoint / PDF conversion

To display PowerPoint (PPT/PPTX/PPS/PPSX/ODP) and PDF documents, the server needs **LibreOffice** (PPT → PDF) and **Poppler** (PDF → per-slide PNG). Install them once:

```bash
sudo bash deploy/linux/install-tools.sh    # Linux — multi-distribution, idempotent
```

`install.bat` handles them on Windows. Conversion status is visible in the media library (badge + *Reconvert* button). Without these tools, all other media types keep working.

## Players

**Web player** — any device with a browser: open `http://<server-ip>:3000/player?key=<hardware-key>` in full screen (F11 / kiosk mode).

**Android player** — v3.4 "anti-lag" fixes the stutter that could persist after v3.3 on high-quality H.264/H.265 videos, and corrects a v3.3 shortcoming: the v3.3 buffer change targeted `DefaultLoadControl$Builder`, but `ExoPlayer$Builder.build()` actually obtains its default `LoadControl` through a lambda calling `new DefaultLoadControl()` directly — so the real start/resume thresholds had stayed 2500/5000 ms. v3.4 patches that exact constructor: playback starts with 5 s of buffer, resumes after an interruption with 10 s ahead, and the 50 s reservoir is trimmed to 20 s — on a network slower than the video bitrate, playback no longer falls into stop/resume cycles, and at high bitrate (e.g. 20 Mbps) the buffer no longer grows to ~125 MB of heap-resident byte arrays (GC pressure and out-of-memory errors on low-end boxes are a frequent hidden cause of stutter and spurious decoder errors). (2) An ExoPlayer error no longer switches instantly to libVLC software decoding, which lags on H.264/H.265 on devices without a hardware decoder: playback is retried twice first (transient network/server errors recover transparently) and the VLC fallback only happens after 3 real failures; the retry counter resets as soon as playback is ready. (3) When the video widget is muted (the CMS default), the audio track is no longer decoded at all, saving CPU and memory. (4) The libvlc software path gains `--avcodec-skiploopfilter=1` (per-frame CPU savings when decoding without a hardware decoder). v3.3 "smooth playback" had already removed the lag-inducing `--no-drop-late-frames`/`--no-skip-frames` libvlc options (they forced decoding of every single frame and accumulated lag as soon as the decoder could not keep up) and switched the VLC engine to SurfaceView (direct hardware path, no per-frame GPU copy) instead of TextureView. Non-stream MP4/MKV H.264/H.265 files go through ExoPlayer (Android hardware decoding); on repeated decoder failure, automatic fallback to libVLC — hence the importance of those fixes for the fallback path. Encoding advice for low-power boxes: H.264 Main/High, 1080p, 4-8 Mbps, AAC 128 kbps, `+faststart` (`ffmpeg -i input.mp4 -c:v libx264 -profile:v main -b:v 6M -c:a aac -b:a 128k -movflags +faststart output.mp4`); H.265/HEVC is smooth only when the device has a hardware decoder. v3.2 "startup fixed" repairs the v3.1 build, which crashed at launch on some devices (notably Xiaomi/MIUI) with `java.lang.VerifyError: Verifier rejected class com.signagecms.player.MainActivity — renderLayout failed to verify: 'this' argument 'java.lang.Object' not instance of 'android.view.ViewGroup'`. Root cause: the v3.1 patch computed the layout signature into register `v0`, which the original code later reused as its null constant (`move-object v1, v0` / `start$default(..., v0)`), so the ART verifier merged the incompatible types into `Object` and rejected the whole class at load time — the app could not even open. The fix restores the null constant at the merge point (a single `const/4 v0, 0x0` instruction) and also removes a leftover duplicated error label in the VLC view; everything else from v3.1 is unchanged. v3.1 "continuous playback" fixes the periodic restarts that made presentations unusable: `RegionView` used to destroy and re-create the widget view every widget cycle even for a single-widget region, so a 14-slide PowerPoint whose widget duration was 10 s could only ever show its first two slides (slideshow restarts from slide 1 every cycle), IPTV/video reconnect-and-black-flash every cycle, and videos restarted from 0:00 — while the web player keeps the same widget alive. v3.1 now keeps the view when the same widget is re-scheduled, and `MainActivity` skips the full layout rebuild when the fetched layout content is unchanged (rotation/schedule refresh), so playback continues seamlessly exactly like the web player. v3.1 also fixes the VLC error handling introduced in v3.0: the real libVLC `EncounteredError` constant is 0x10a (v3.0 tested 0x110, an event that never fires, so a broken stream stayed a silent black screen); errors now trigger bounded retries with back-off (3 s / 6 s / 9 s), the counter resets on successful playback, and after 3 consecutive failures the stream stops and an explicit on-screen label replaces the black screen. v3.0 completed the media coverage (verified end-to-end against the layout JSON the player consumes): videos (mp4/webm/mov/mkv/avi/mpg/mpeg/3gp/ts → ExoPlayer, exotic containers and rtsp/rtmp/udp streams → libVLC with automatic fallback), images (png/jpg/jpeg/gif/webp/svg/bmp/ico/tiff), PowerPoint (ppt/pptx/pps/ppsx/odp) and PDF — both converted server-side into PNG slides whose URLs are made absolute before display, IPTV (m3u8/HLS, TS, rtsp…), web pages, text, clock, weather and RSS. v2.9 fixed a `java.lang.NoSuchFieldError` crash at startup: `MainActivity` read and wrote two caching fields (`lastAppliedW` / `lastAppliedH`) that were never declared in the class, so the very first layout pass after `onCreate` died. Both fields are restored, which keeps the original "skip re-layout when size unchanged" guard. v2.8 fixed a `java.lang.VerifyError` crash on some devices (notably Xiaomi/MIUI): the ART verifier rejected `Json.parseLayout` because a register holding the saved regions count was reused for the new `Widget` instance. Previous builds: v3.1 (continuous playback), v3.0 (absolute slide URLs + VLC fallback), v2.9 (restored fields), v2.8 (layout-parsing fix), v2.7 (hardened rendering), v2.6 (crash-report build), v2.5 (connection stabilization). When hosted by the CMS, APK files are served from `/apk/` — e.g. `http://<server-ip>:3000/apk/SignageCMS-Player-v3.4-antitag.apk`.

The player registers with the server (`/api/player/register`), pulls its schedule (`/api/player/schedule`), sends heartbeats (`/api/player/heartbeat`) and reports playback statistics (`/api/player/stats`).

## Main API endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/version` | Server version (used by install.sh for the final check) |
| `GET /api/server-info` | Server/port information |
| `POST /api/auth/login` · `/logout` · `/me` | Session management (JWT) |
| `GET|POST /api/resource/<resource>` · `.../[id]` | CRUD for displays, media, playlists, layouts, campaigns, events, users… |
| `POST /api/upload` | Media upload |
| `GET /api/player/register` · `schedule` · `heartbeat` · `stats` | Player protocol |
| `POST /api/ldap/sync` | LDAP/AD user import |
| `GET /api/iptv/*` | IPTV providers, playlists, channels, proxy |

## Documentation

The complete 43-page installation & user guide (Windows + Linux, with screenshots) ships with the distribution:

**`Guide-Installation-Utilisation-SignageCMS-v3.11.12.pdf`** — also served at `/downloads/Guide-Installation-Utilisation-SignageCMS-v3.11.12.pdf` when hosted by the CMS.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Server does not start | Check `service.log` (daemon mode); verify `.env` exists and `DATABASE_URL` points to a writable path |
| PPT/PDF stuck at "Not converted" | Install LibreOffice + Poppler (`install-tools.sh`), restart the server, click *Reconvert* |
| Build fails or is killed | Free RAM (build needs ~2 GB: `NODE_OPTIONS=--max-old-space-size=2048 npm run build`) |
| Player shows the standby clock | No active schedule event for this display — check the *Scheduling* page and the display's hardware key |
| Videos won't play on the Android player (web is fine or slow) | The server must answer media requests with HTTP **206 Partial Content**. Check: `curl -s -o /dev/null -w '%{http_code}' -H 'Range: bytes=0-1023' http://<server>:3000/uploads/<file>.mp4` — if it returns `200`, restart with **Node.js** (`node .next/standalone/server.js`), not Bun/Bun-compatible runtimes which break Range support |
| High-quality H.264/H.265 videos stutter on the Android player | Install player **v3.4 "anti-lag"** (the real ExoPlayer buffers are now patched — the v3.3 change missed the actual code path — 20 s reservoir, 2 Exo retries before the VLC fallback, no audio decoding when muted, libvlc skiploopfilter). If stutter persists, the video exceeds the device decoding capability: re-encode to H.264 Main/High 1080p 4-8 Mbps with `-movflags +faststart`; H.265/HEVC is smooth only with a hardware decoder on the device |
| Forgot the admin password | Regenerate credentials on the server host, then restart |
| Port already in use | Change `PORT` in `.env` or pass `--port` to `install.sh`, then restart |

## Version notes

- **3.11.13** — web player videos no longer freeze until the volume button is clicked: the `muted` attribute is set before loading (browser autoplay policy), playback is explicitly orchestrated with a muted fallback, and the first touch on the page restores the sound requested by the user (remembered preference). Same hardening applied to IPTV widgets.
- **3.11.12** — loop-OFF campaigns now play exactly once (previously froze on the last page); hardened `install.sh` (non-privileged mode, anti-false-OK checks, tool probes with timeout).
- **3.11.11 / 3.11.12 installers** — `install.sh` (complete Linux installation), `start.sh` (process control), `install-tools.sh` (LibreOffice + Poppler only).
- See `VERSION` for the current server version and the PDF guide for the full history.
