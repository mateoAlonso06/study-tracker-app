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
- [x] T2 "Archivos" tab per subject: add button, drag and drop, grid with thumbnails, preview modal, context menu (open, save as, edit, delete)
- [x] T3 Inline images in notes: editor upload handler (toolbar, paste, drop), sanitizer allows only `studyfiles://file/<id>`, orphan sweep
- [x] T4 Session cards: file count and "+ Archivo"
- [x] T5 Export / import zip (Options menu), tokens excluded, safe import, restart after import
- [ ] T6 Global search (Ctrl+K): notes, files, sessions, jump to result
- [ ] T7 Docs (README, manual), packaged build smoke test, final checks

## Acceptance criteria
- A PDF and an image can be added by button and by drag and drop, previewed in the app, renamed, saved elsewhere and deleted.
- An image pasted into a note shows after restart and in the notes tab.
- Export then import on a clean profile folder restores every profile, note, session and file.
- Search finds text in a note, a file name and a session topic and opens the right place.
- A malicious zip (path traversal, bad database) is rejected without touching current data.

## Progress
T1-T5 done (storage, Files tab, inline images, session file counts, export/import). Next: T6 global search.

## Verification evidence
- T1 (scripted run against the real app): png/pdf/txt/exe added; >100 MB, empty file, directory and missing path rejected with clear messages;
  image served through studyfiles:// (640x400 loads); unknown id, wrong host, other user and no user all get 404;
  PDF rendered by Chromium's built-in viewer inside an iframe (thumbnails, zoom, print); delete removes the file from disk;
  safe-to-open rule checked for 14 extensions (exe, sh, AppImage, desktop, jar, bat, msi, ps1, html, svg never open directly).
- T2 (scripted run, real file drops from the OS through the debug port): 6 files dropped, 5 added, 100 MB+ rejected with a toast; tab count updates;
  drop hint shows the subject name; no navigation to the dropped file; image preview, PDF preview in the built-in viewer, prev/next with arrow keys,
  Escape and background click close; search, type and session filters; context menu (Ver, Abrir con el sistema, Mostrar en la carpeta, Guardar una copia, Editar, Borrar);
  rename + link to a session; delete removes the file from disk (5 -> 4); dropping on Inicio shows the hint and does nothing.
- T3 (scripted runs, two app starts): image button in the toolbar; images inserted by the editor uploader, by a real paste event and by a real OS file drop
  onto the editor (3/3 stored as inline attachments, no base64, none shown in the Files tab); saved note keeps the references and renders in the Notas tab;
  click opens the preview without arrows; sanitizer drops remote and base64 images and strips onerror/width, script text only; image-only note is not treated as empty;
  after an app restart the image of an editor closed without saving is removed, the live-session draft keeps its image (loads, editor shows it, saves into a note);
  deleting a note frees its images only after the 10 minute guard (checked by aging the rows).
- T4 (scripted run, real drops): session cards show "+ Archivo"; dropping on a session card attaches to that session (hint names the session), card shows "Ver archivos (n)" which opens the Files tab filtered to it;
  dropping elsewhere attaches to the subject only; deleting a session keeps its files unlinked.
- T5 (scripted runs through the real IPC handlers and the real UI; native dialogs replaced from the main-process inspector):
  export gives a valid zip (manifest, db, 4 files); Spotify/remember tokens and spotify settings are absent from the zip, bytes included
  (a first run FOUND the fake secrets in the db free pages: fixed with secure_delete + VACUUM, re-run found none); live db untouched, no temp leftovers.
  17 hostile/broken zips (../ and deep traversal, absolute path, backslash name, unexpected file and folder, name not matching our pattern, missing manifest,
  missing db, corrupt db, db without required tables, attachment row pointing outside the folder, wrong app, future format, bad manifest json, duplicate entry, not a zip)
  all rejected with a clear message; db hash and files unchanged; no staging left; nothing written outside the app folder.
  Import over existing data: app restarted by itself, data equals the backup (profiles, password hash login, notes, inline image, pdf), tokens gone,
  previous db + files kept in backups-before-import; stale staging dir removed at startup; startup toast with the safety folder.
  Forced failure half way: everything restored (db hash identical), error reported, app restarted, no empty safety folder.
  UI: import link on the login screen (new PC), confirmation dialog with counts, Cancel and Escape discard the staged copy, Options menu export and import entries.
- Not run: the OS actions themselves (the native file dialogs behind the "+ Archivo" button and the export/import pickers, replaced in tests; the AppImage/portable relaunch path of Import) (open, reveal in folder, save as dialog), to avoid launching programs on the desktop.

## Next step
T6 global search (Ctrl+K).
