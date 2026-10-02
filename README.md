# Study Tracker

A desktop app to keep your study habit consistent. Track study sessions per subject, take notes while you study,
run Pomodoro sessions, follow your streaks and control Spotify from the sidebar.

Everything is stored **locally** in a single SQLite file. No account, no cloud.

> New here? Read the [user guide](docs/MANUAL.md) after installing.

## Features

- Profiles with an optional password (several people can share one PC).
- Subjects with a weekly hour goal, a streak and an activity heatmap.
- Live study sessions: timer (free or Pomodoro), pause, and a **notes manager** (many notes per session,
  rich-text editor, drag to reorder).
- Notes tab per subject with search and filters.
- Light, dark or system theme.
- Optional Spotify player (needs Premium).

## Install

Pick one option.

### Option 0: one command (Linux x86_64)

```bash
curl -fsSL https://raw.githubusercontent.com/mateoAlonso06/study-tracker-app/main/install.sh | bash
```

It downloads the latest release and installs it: the `.deb` on Debian/Ubuntu (asks for `sudo`), or the AppImage under
`~/.local` plus an entry in your application menu on any other distro. Run the same command again to update.
Your data is never touched.

To uninstall (your data in `~/.config/study-tracker` is kept):

```bash
curl -fsSL https://raw.githubusercontent.com/mateoAlonso06/study-tracker-app/main/install.sh | bash -s -- --uninstall
```

Optional environment variables: `STUDY_TRACKER_VERSION=v0.1.0` (install a specific version) and
`STUDY_TRACKER_METHOD=deb|appimage` (skip the automatic choice). Example:
`curl -fsSL <url> | STUDY_TRACKER_METHOD=appimage bash`.

> It needs at least one published release. Create it by pushing a tag, see
> [Building the installers](#building-the-installers). As with any `curl | bash`, you can read the script first:
> [`install.sh`](install.sh).

### Option A: installers

Installers are not stored in git (they are about 100 MB). You can get them in two ways:

- **From GitHub Actions** (easiest from another PC): push a tag like `v0.1.0` or run the **Build installers**
  workflow manually, then download the files from the run's *Artifacts* (or from the *Releases* page for tags).
  See [Building the installers](#building-the-installers).
- **Build them yourself** on a PC that has the repo (`npm run dist:linux` / `npm run dist:win`) and copy the
  files from `dist/`.

#### Linux

| File | How to use it |
| --- | --- |
| `StudyTracker-<version>-linux-x86_64.AppImage` | No installation. `chmod +x StudyTracker-*.AppImage`, then double-click it or run `./StudyTracker-*.AppImage`. |
| `StudyTracker-<version>-linux-amd64.deb` | Debian/Ubuntu: `sudo apt install ./StudyTracker-*-linux-amd64.deb`. Adds "Study Tracker" to your application menu. |

If the AppImage fails with a *FUSE* error (common on Ubuntu 22.04 and newer):

```bash
sudo apt install libfuse2        # on Ubuntu 24.04 the package is libfuse2t64
# or, without installing anything:
./StudyTracker-*.AppImage --appimage-extract-and-run
```

#### Windows

| File | How to use it |
| --- | --- |
| `StudyTracker-Setup-<version>-win-x64.exe` | Installer. Lets you choose the folder and creates desktop and Start menu shortcuts. |
| `StudyTracker-Portable-<version>-win-x64.exe` | No installation. Double-click to run it from anywhere (for example a USB drive). |

The app is **not code-signed**, so Windows SmartScreen may show *"Windows protected your PC"*.
Click **More info** and then **Run anyway**.

### Option B: run from source

Requires [Git](https://git-scm.com/) and a recent [Node.js](https://nodejs.org/) LTS
(the app itself runs on the Node version bundled inside Electron).

```bash
git clone <your-repository-url>
cd study-tracker
npm install
npm start
```

On Linux, `npm start` adds `--no-sandbox` for you (needed when Electron's sandbox helper is not configured). On Windows and macOS the sandbox stays enabled.

## Where your data lives

| System | Folder |
| --- | --- |
| Linux | `~/.config/study-tracker/` |
| Windows | `%APPDATA%\study-tracker\` |

The database is `study-tracker.db` in that folder.

**Move your data to another PC:** close the app on both PCs, then copy `study-tracker.db` from the old folder
into the new one (create the folder if it does not exist). Profiles, passwords, subjects, sessions and notes come with it.

Things that are per computer and must be set up again on the new PC:

- **Keep me signed in** (just tick it again at login).
- **Spotify** (connect again from *Opciones > Spotify*). Spotify tokens are encrypted with each computer's keychain,
  so they cannot be reused elsewhere.
- Theme preference.

To start from scratch, close the app and delete that folder.

## Building the installers

### On GitHub (no local setup)

The workflow in [`.github/workflows/build.yml`](.github/workflows/build.yml) builds Linux and Windows installers on
GitHub's machines.

1. Push the repository to GitHub.
2. Either create and push a tag, or run it manually from the **Actions** tab (*Build installers > Run workflow*):

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. When it finishes, download the installers from the run's **Artifacts**. For tags they are also attached to a
   release on the **Releases** page.

### On your own machine

```bash
npm install
npm run dist:linux     # AppImage and .deb      -> dist/
npm run dist:win       # Windows installer and portable exe -> dist/ (on Linux this needs Wine)
npm run dist           # both
```

macOS builds are not configured.

## Spotify (optional)

Control Spotify from the sidebar: play/pause, next/previous, seek, volume, shuffle, repeat, device and playlists.
It controls playback through the Spotify Web API (the music plays in your Spotify app; this app does not stream audio).
Requires Spotify Premium.

1. Create an app at <https://developer.spotify.com/dashboard> (check "Web API").
2. Add this Redirect URI exactly: `http://127.0.0.1:43871/callback`
3. In the app: **Opciones > Spotify**, paste the Client ID and connect.

Login uses Authorization Code with PKCE (no client secret). Tokens are only handled by the main process and are
encrypted with the OS keychain (Electron `safeStorage`) when available.

Notes:

- Apps in Spotify's Development Mode only allow the owner and users added under "User Management".
- Spotify needs an active device (Spotify open on your PC or phone). The app wakes an available one when you press play.
- Port `43871` must be free while connecting.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| AppImage does nothing when double-clicked | Make it executable (`chmod +x`), or run it from a terminal to see the error. |
| AppImage says it needs FUSE | See [Linux](#linux) above (`libfuse2` or `--appimage-extract-and-run`). |
| Windows shows "Windows protected your PC" | The app is unsigned. **More info > Run anyway**. |
| The window does not open the second time | Only one copy can run at a time. Look for the already open window. |
| Spotify says "No hay ningún dispositivo activo" | Open Spotify on any device, play something once, then try again. |
| Spotify connection fails with port error | Something else uses port `43871`. Close it and retry. |
| Forgot a profile password | There is no recovery. Move the data folder away to start fresh, or keep a backup of `study-tracker.db`. |

## Project layout

```
src/main.js          Electron main process, SQLite schema and IPC
src/spotify.js       Spotify login (PKCE) and player API
src/preload.js       Safe bridge between the UI and the main process
src/renderer/        UI (plain HTML, CSS and JavaScript, Quill editor)
build/icon.png       App icon
docs/MANUAL.md       User guide
```

## License

MIT
