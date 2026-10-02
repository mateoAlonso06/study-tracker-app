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
