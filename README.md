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
- Notes tab per subject with search and filters, and **images inside notes** (button, paste or drag and drop).
- **Files tab per subject**: attach images, PDFs or any file, preview images and PDFs inside the app, link files to sessions.
- **Global search** (`Ctrl+K`) across notes, files, sessions and subjects.
- **Export and import** everything (data and files) as a single zip, to back up or move to another PC.
- Light, dark or system theme.
- Optional Spotify player (needs Premium).

## Install

Pick one option. On Linux the fastest is the one-line command; on Windows use the installer.

### Option 1: one command (Linux x86_64)

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

### Option 2: installers (Linux and Windows)

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

### Option 3: run from source

Requires [Git](https://git-scm.com/) and a recent [Node.js](https://nodejs.org/) LTS
(the app itself runs on the Node version bundled inside Electron).

```bash
git clone <your-repository-url>
cd study-tracker
npm install
npm start
```

On Linux, `npm start` adds `--no-sandbox` for you (needed when Electron's sandbox helper is not configured). On Windows and macOS the sandbox stays enabled.

## Status and known limitations

- Linux installers (AppImage and `.deb`) were built and the AppImage was tested end to end.
- The Windows installers are built the same way but **have not been run on a real Windows machine yet**.
  Please report anything odd.
- Installers are **not code-signed** (Windows SmartScreen will warn, see above).
- Only x86_64 Linux and 64-bit Windows are built. There is no macOS or ARM build.
- Files are stored as they are on your computer (not encrypted), and backups (`.zip`) are not encrypted either.
  Keep them somewhere you trust.
- Each file can be up to 100 MB. Search looks at file **names**, not inside PDFs or other documents.
- Windows builds of the file, backup and search features were built by CI but not run on a real Windows machine yet.
- No automatic updates: install a newer version over the old one (on Linux, run the one-line command again).

## Where your data lives

| System | Folder |
| --- | --- |
| Linux | `~/.config/study-tracker/` |
| Windows | `%APPDATA%\study-tracker\` |

Inside that folder:

- `study-tracker.db`: profiles, subjects, sessions, notes and file records.
- `files/`: the files you attach (images, PDFs...).
- `backups-before-import/`: copies of what an import replaced, kept in case you want to go back. Delete them when you no longer need them.

### Back up or move to another PC

Use the built-in export and import. Copying only `study-tracker.db` is **not** enough anymore, because the attached files live in `files/`.

1. On the old PC: **Opciones > Exportar datos…** and save the `.zip`.
2. Copy the `.zip` to the new PC (USB drive, cloud drive...).
3. On the new PC, install the app. On the first screen choose **Importar datos de un respaldo…**
   (or **Opciones > Importar datos…** if you already use the app).
4. The app shows what the backup contains and asks for confirmation. **Importing replaces everything currently in the app**;
   the previous data is moved to `backups-before-import/`. The app restarts when it finishes.

What a backup does and does not contain:

- It contains every profile (with password hashes), subject, session, note and attached file of the computer.
- It does **not** contain Spotify connections or "keep me signed in" sessions.
- It is not encrypted. Anyone with the file can read your notes, so share backups only with people you trust.
  An imported backup is checked before it is used (file names, database integrity, format), and a damaged or suspicious one is refused.

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
| Forgot a profile password | There is no recovery. Import a backup made before, or move the data folder away to start fresh. |
| Import says the file is not valid | Only `.zip` files made by **Exportar datos…** work. A zip that was edited or comes from something else is refused on purpose. |
| A file does not open with **Abrir con el sistema** | For safety only common document, image, audio and video types are opened. Other types (programs, scripts...) are shown in their folder instead. |
| A PDF looks blank in the preview | Close the preview and open it again, or use **Abrir con el sistema** to view it with your PDF reader. |

## Project layout

```
src/main.js          Electron main process, SQLite schema and IPC
src/spotify.js       Spotify login (PKCE) and player API
src/files.js         Attachments: storage on disk, studyfiles:// protocol, safe open
src/backup.js        Export/import of all data as a zip (validation, staging, rollback)
src/preload.js       Safe bridge between the UI and the main process
src/renderer/        UI (plain HTML, CSS and JavaScript, Quill editor)
build/icon.png       App icon
docs/MANUAL.md       User guide
```

## License

MIT
