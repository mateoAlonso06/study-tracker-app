# Study tracker

Local desktop app (Electron + SQLite) to track study sessions, notes and streaks per subject.

- Profiles with optional password, stored locally (scrypt-hashed).
- Per subject: weekly hour goal, streak, activity heatmap, sessions with notes and "where I left off".
- Data lives in a single SQLite file in the Electron user data folder (`~/.config/study-tracker/study-tracker.db` on Linux).

## Run

```bash
npm install
npm start
```

Requires Node 22.13+ (uses the built-in `node:sqlite`). `--no-sandbox` in the start script is needed on some Linux setups.

## Spotify (optional)

Control Spotify from the sidebar: play/pause, next/previous, seek, volume, shuffle, repeat, device and playlists.
It controls playback through the Spotify Web API (the music plays in your Spotify app); it does not stream audio itself.
Requires Spotify Premium.

1. Create an app at https://developer.spotify.com/dashboard (check "Web API").
2. Add this Redirect URI exactly: `http://127.0.0.1:43871/callback`
3. In the app: Options > Spotify, paste the Client ID and connect.

Login uses Authorization Code with PKCE (no client secret). Tokens are only handled by the main process and are
encrypted with the OS keychain (Electron `safeStorage`) when available.

Notes:
- Apps in Spotify's Development Mode only allow the owner and users added under "User Management".
- Spotify needs an active device (Spotify open on your PC or phone); the app wakes an available one when you press play.
