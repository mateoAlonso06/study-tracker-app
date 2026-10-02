# Study Tracker: user guide

A short guide to everything you need. The app's interface is in Spanish, so button names are written
exactly as you will see them, for example **Iniciar sesión**.

Contents: [First steps](#1-first-steps) · [Subjects](#2-subjects) · [Studying: live sessions](#3-studying-live-sessions) ·
[Pomodoro](#4-pomodoro) · [Notes during a session](#5-notes-during-a-session) · [Saving a session](#6-saving-a-session) ·
[Sessions and notes of a subject](#7-sessions-and-notes-of-a-subject) · [Options](#8-options-theme-spotify-sign-out) ·
[Tips](#9-tips-and-shortcuts) · [FAQ](#10-faq)

## 1. First steps

1. Open the app. On the first run you see **Creá tu primer perfil para empezar**.
2. Click **+ Nuevo perfil**, type a name and, if you want, a password.
3. Tick **Mantener sesión activa** if you do not want to type your password every time on this computer.
   You can sign out at any moment from **Opciones**.
4. Click **Crear perfil**. You land on **Inicio**.

Each profile has its own subjects, sessions and notes. If you share the PC, each person creates a profile.

## 2. Subjects

A subject is anything you study: "AWS Cloud Practitioner", "English", "Spring"...

- Click **+ Nueva materia** (in the left bar or on **Inicio**).
- Type a name and a **weekly goal in hours** (use `0` for no goal).
- Click the subject in the left bar to open it. **Editar materia** lets you rename it, change the goal or delete it.
  Deleting a subject also deletes its sessions and notes.

On **Inicio** every subject shows:

- **Streak** (`2 d`): consecutive days with at least one session in that subject.
- A progress bar of the hours studied **this week** (the week starts on Monday) against your goal.
- **Seguís en:** where you stopped last time (for example `IAM (min 42:10)`).
- **Iniciar sesión** and **Registrar manual** buttons.

## 3. Studying: live sessions

1. Click **Iniciar sesión** on a subject.
2. Choose the mode: **Libre (cronómetro)** or **Pomodoro**, then click **Comenzar**.
3. The live screen opens: the timer on top, your notes below.

Controls on the live screen:

| Button | What it does |
| --- | --- |
| **Pausar** / **Reanudar** | Stops and resumes the clock. Paused time is not counted. |
| **Saltar fase** | Pomodoro only: jump to the next phase. |
| **Detener y guardar** | Finishes the session and opens the save form. |
| **Descartar** | Throws the whole session and its notes away (asks for confirmation). |

Good to know:

- While a session runs it appears at the top of the left bar with its clock. You can browse other screens and come back.
- If you close the app or the PC turns off, the session comes back **paused** with all your notes. You lose at most a few seconds.
- If the computer goes to sleep, the sleeping time is not counted.

## 4. Pomodoro

In **Pomodoro** mode the clock counts down through focus and break phases. You can set:

- **Foco (min)**: default 25.
- **Descanso corto (min)**: default 5.
- **Descanso largo (min)**: default 15.
- **Pomodoros hasta el descanso largo**: default 4.
- **Pasar de fase automáticamente**: moves to the next phase without waiting for you.

When a phase ends you hear a beep and get a system notification. **Only focus time counts as study time**; breaks do not.
Your settings are remembered for next time.

## 5. Notes during a session

The left column of the live screen is the **notes manager**. A session can have as many notes as you want, each
with its own title and as much text as you need.

- **+ Nota** creates a new note. Type its title in **Título de la nota** and write in the editor.
- Click a note in the list to open it.
- The editor has headings, bold, italic, underline, strikethrough, numbered and bulleted lists, quotes, code and links.
- **Reorder:** drag a note up or down, or focus it and press **Alt + ↑ / ↓**.
- **Delete:** right-click a note and choose **Borrar** (it asks for confirmation if the note has content).
  This is the only way to delete a note here.
- Everything is saved automatically while you type.

## 6. Saving a session

Click **Detener y guardar**. The form shows:

- **Duración (minutos)**: filled in for you; edit it if needed.
- **Tema o lección** and **Hasta dónde llegaste** (for example `min 42:10` of a video, or `unit 3`).
  The next time you start, **Seguís en** reminds you where you stopped.

Click **Guardar sesión**. Each note you wrote is saved as its own note, linked to the session. Empty notes are discarded.

Forgot to start the timer? Use **Registrar manual**: pick the date, the duration in minutes, the topic and the position.

## 7. Sessions and notes of a subject

Open a subject. At the top you see your **Racha**, the hours **Esta semana**, the **Total** and the number of **Sesiones**.
Below there are two tabs:

### Sesiones

- An activity map of the last 20 weeks (darker means more hours that day).
- The list of sessions, newest first. Each one has **+ Nota**, **Editar sesión** and **Borrar sesión**.
  Deleting a session also deletes its notes.

### Notas

All the notes of the subject, grouped by session, newest sessions first. Inside a session, notes appear in the order you wrote them.

- **Search:** type in **Buscar en títulos y contenido**. It ignores capital letters and accents, and when you type
  several words, all of them must match. It also looks at the session topic.
- **Filters:** **Desde** / **Hasta** (dates), **Orden** (newest or oldest first) and **Vista** (grouped by session or a simple list).
  **Limpiar filtros** resets everything.
- Click a note to expand it. Use **Editar** to change it (you can even move it to another session) or **Borrar** to delete it.
- **+ Nueva nota** creates a note, with or without a session.

## 8. Options: theme, Spotify, sign out

Click **Opciones** at the bottom left.

- **Tema:** **Claro**, **Oscuro** or **Sistema** (follows your computer).
- **Spotify:** connect your account and control music from the left bar. Setup steps are in the
  [README](../README.md#spotify-optional). Needs Spotify Premium.
  Once connected you get a mini player (previous, play/pause, next). Click it for the full player: progress, volume,
  shuffle, repeat, device and your playlists.
- **Cerrar sesión:** goes back to the profile screen and forgets "keep me signed in" on this computer.

## 9. Tips and shortcuts

- **Esc** closes menus and dialogs.
- **Alt + ↑ / ↓** moves the focused note in the live notes list.
- Right-click a note in the live list to delete it.
- Put the thing you will do next in **Hasta dónde llegaste**; it saves you from searching where you were.
- A streak counts a day if you saved at least one session that day, so even a short session keeps it alive.

## 10. FAQ

**Where is my data?**
In one file on your computer. See [Where your data lives](../README.md#where-your-data-lives).

**How do I move my data to another PC?**
Copy `study-tracker.db` with the app closed. Details in the README.

**Can I use it on two PCs at the same time?**
Not synchronized. Each computer has its own copy of the data.

**I forgot my password.**
There is no recovery, passwords are stored as hashes. Restore a backup of `study-tracker.db`, or start a new profile.

**The timer lost some seconds after a crash.**
The session is saved every few seconds, so a crash can lose a few seconds at most.

**Why does Spotify say there is no active device?**
Spotify must be open on some device. Play anything once there, then use the controls again.
