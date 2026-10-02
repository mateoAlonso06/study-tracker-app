# Documents, backup and global search

## Objective
Let people attach documents (images, PDFs, any file) to their study material, open them inside the app,
keep a complete backup (database and files) and search across everything.

## Problem / why
The app only holds text notes. To replace the scattered docs/notes people keep today it must also hold the
files they study from, and those files must survive a move to another PC. Sync and collaboration are out of
scope for now (decided with the user).

## Scope
In: attachments per subject (optional session link), preview of images and PDFs, inline images in notes,
export/import as a single zip, global search (notes, files, sessions).
Out: cloud sync, collaboration, full-text search inside PDFs, auto-update, code signing.

## Constraints and decisions
- Files live on disk under `<userData>/files/<userId>/`, the database only stores metadata (no BLOBs).
- Files are served to the UI only through a custom `studyfiles://` protocol that checks ownership in the database.
- Only previewable types (images, PDF) are rendered; other types are opened by the OS only if the extension is
  on a safe list, otherwise they are shown in the folder (a shared backup could contain an executable).
- Backups never contain Spotify or remember-me tokens.
- Import validates zip entry names (no path traversal) and the database before replacing anything, keeps a safety copy.
- TDD: off (the project has no test runner). Functional checks: scripted UI runs against the real app via the debug port.

## Tasks
- [x] T1 Storage: `attachments` table, files folder, `studyfiles://` protocol, IPC (add from path/bytes, list, update, delete, open, save as), PDF preview spike
- [ ] T2 "Archivos" tab per subject: add button, drag and drop, grid with thumbnails, preview modal, context menu (open, save as, edit, delete)
- [ ] T3 Inline images in notes: editor upload handler (toolbar, paste, drop), sanitizer allows only `studyfiles://file/<id>`, orphan sweep
- [ ] T4 Session cards: file count and "+ Archivo"
- [ ] T5 Export / import zip (Options menu), tokens excluded, safe import, restart after import
- [ ] T6 Global search (Ctrl+K): notes, files, sessions, jump to result
- [ ] T7 Docs (README, manual), packaged build smoke test, final checks

## Acceptance criteria
- A PDF and an image can be added by button and by drag and drop, previewed in the app, renamed, saved elsewhere and deleted.
- An image pasted into a note shows after restart and in the notes tab.
- Export then import on a clean profile folder restores every profile, note, session and file.
- Search finds text in a note, a file name and a session topic and opens the right place.
- A malicious zip (path traversal, bad database) is rejected without touching current data.

## Progress
T1 done: storage, protocol, IPC and PDF preview verified. Next: T2 UI.

## Verification evidence
- T1 (scripted run against the real app): png/pdf/txt/exe added; >100 MB, empty file, directory and missing path rejected with clear messages;
  image served through studyfiles:// (640x400 loads); unknown id, wrong host, other user and no user all get 404;
  PDF rendered by Chromium's built-in viewer inside an iframe (thumbnails, zoom, print); delete removes the file from disk;
  safe-to-open rule checked for 14 extensions (exe, sh, AppImage, desktop, jar, bat, msi, ps1, html, svg never open directly).
- Not run: the OS actions themselves (open, reveal in folder, save as dialog), to avoid launching programs on the desktop.

## Next step
T2 "Archivos" tab.
