#!/usr/bin/env bash
# Study Tracker installer for Linux (x86_64).
#
#   Install or update:  curl -fsSL https://raw.githubusercontent.com/mateoAlonso06/study-tracker-app/main/install.sh | bash
#   Uninstall:          curl -fsSL https://raw.githubusercontent.com/mateoAlonso06/study-tracker-app/main/install.sh | bash -s -- --uninstall
#
# Debian/Ubuntu: installs the .deb (needs sudo). Any other distro: installs the AppImage under ~/.local and
# adds an entry to the application menu. Your data in ~/.config/study-tracker is never touched.
#
# Optional environment variables:
#   STUDY_TRACKER_VERSION=v0.1.0    install a specific release instead of the latest
#   STUDY_TRACKER_METHOD=deb|appimage   skip the automatic choice
#   STUDY_TRACKER_DRY_RUN=1         print the privileged commands instead of running them

set -euo pipefail

REPO="mateoAlonso06/study-tracker-app"
API="${STUDY_TRACKER_API:-https://api.github.com/repos/${REPO}/releases}"
ICON_URL="${STUDY_TRACKER_ICON_URL:-https://raw.githubusercontent.com/${REPO}/main/build/icon.png}"

TMP_DIR=""
APP_DIR="${HOME}/.local/share/study-tracker"
BIN_LINK="${HOME}/.local/bin/study-tracker"
DESKTOP_FILE="${HOME}/.local/share/applications/study-tracker.desktop"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33maviso:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# Runs a command as root (directly, or through sudo). Honors the dry-run switch.
run_root() {
  if [ -n "${STUDY_TRACKER_DRY_RUN:-}" ]; then
    printf '[dry-run] %s\n' "$*"
  elif [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

can_use_root() {
  [ "$(id -u)" -eq 0 ] || command -v sudo >/dev/null 2>&1
}

uninstall() {
  if command -v dpkg >/dev/null 2>&1 && dpkg -s study-tracker >/dev/null 2>&1; then
    say "Desinstalando el paquete .deb"
    run_root apt-get remove -y study-tracker
  fi
  rm -rf "$APP_DIR" "$BIN_LINK" "$DESKTOP_FILE"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "${HOME}/.local/share/applications" 2>/dev/null || true
  say "Listo. Tus datos en ~/.config/study-tracker no se borraron."
}

# Prints the download URL of the first release asset whose name matches the given extended regex.
asset_url() {
  printf '%s\n' "$RELEASE_JSON" \
    | grep -o '"browser_download_url": *"[^"]*"' \
    | sed 's/^"browser_download_url": *"//; s/"$//' \
    | grep -E "$1" | head -n 1 || true
}

download() {
  curl -fL --retry 3 --progress-bar -o "$2" "$1" || die "No se pudo descargar $1"
  # A real installer is tens of megabytes; anything tiny is an error page.
  [ "$(wc -c <"$2")" -gt 1000000 ] || die "La descarga parece incompleta: $1"
}

install_deb() {
  local file="$1"
  say "Instalando el paquete .deb (te puede pedir tu contraseña de sudo)"
  chmod 755 "$(dirname "$file")" && chmod 644 "$file" # apt's _apt user must be able to read it
  run_root apt-get install -y "$file"
}

install_appimage() {
  local file="$1" extra=""
  say "Instalando el AppImage en ${APP_DIR}"
  mkdir -p "$APP_DIR" "$(dirname "$BIN_LINK")" "$(dirname "$DESKTOP_FILE")"
  install -m 755 "$file" "${APP_DIR}/StudyTracker.AppImage"

  # AppImages need FUSE 2 to mount themselves; without it they must unpack on every start (slower).
  if ! { /sbin/ldconfig -p 2>/dev/null || ldconfig -p 2>/dev/null; } | grep -q 'libfuse\.so\.2'; then
    extra="--appimage-extract-and-run"
    warn "Falta FUSE 2: el programa arrancará más lento. Para mejorarlo instalá libfuse2 (fuse-libs en Fedora, fuse2 en Arch)."
  fi
  printf '#!/bin/sh\nexec "%s/StudyTracker.AppImage" %s "$@"\n' "$APP_DIR" "$extra" >"$BIN_LINK"
  chmod 755 "$BIN_LINK"

  local icon_line=""
  if curl -fsSL -o "${APP_DIR}/icon.png" "$ICON_URL" 2>/dev/null; then icon_line="Icon=${APP_DIR}/icon.png"; fi
  cat >"$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Study Tracker
Comment=Track study sessions, notes and streaks
Exec=${BIN_LINK} %U
${icon_line}
Terminal=false
Categories=Education;
StartupWMClass=study-tracker
EOF
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$DESKTOP_FILE")" 2>/dev/null || true
  case ":${PATH}:" in
    *":${HOME}/.local/bin:"*) ;;
    *) warn "Para abrirlo desde la terminal agregá ~/.local/bin a tu PATH. Desde el menú de aplicaciones ya funciona." ;;
  esac
}

main() {
  case "${1:-}" in
    --uninstall) uninstall; return ;;
    "") ;;
    *) die "Opción desconocida: $1 (la única opción es --uninstall)" ;;
  esac

  [ "$(uname -s)" = "Linux" ] || die "Este instalador es solo para Linux."
  case "$(uname -m)" in x86_64 | amd64) ;; *) die "Solo hay instaladores para x86_64 (tu equipo es $(uname -m))." ;; esac
  command -v curl >/dev/null 2>&1 || die "Necesito curl para descargar el instalador."

  local version="${STUDY_TRACKER_VERSION:-}" url
  if [ -n "$version" ]; then url="${API}/tags/${version}"; else url="${API}/latest"; fi
  say "Buscando la versión ${version:-más reciente}"
  RELEASE_JSON="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$url")" \
    || die "No encontré ninguna versión publicada en https://github.com/${REPO}/releases (¿todavía no se creó la primera?)."

  local method="${STUDY_TRACKER_METHOD:-auto}"
  if [ "$method" = "auto" ]; then
    if command -v apt-get >/dev/null 2>&1 && command -v dpkg >/dev/null 2>&1 && can_use_root; then method="deb"; else method="appimage"; fi
  fi

  # Global on purpose: the EXIT trap runs after main() returns, when locals no longer exist.
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "${TMP_DIR:-}"' EXIT
  local tmp="$TMP_DIR"

  case "$method" in
    deb)
      local deb_url
      deb_url="$(asset_url 'linux-amd64\.deb$')"
      [ -n "$deb_url" ] || die "La versión no incluye un paquete .deb."
      say "Descargando $(basename "$deb_url")"
      download "$deb_url" "${tmp}/study-tracker.deb"
      install_deb "${tmp}/study-tracker.deb"
      ;;
    appimage)
      local ai_url
      ai_url="$(asset_url 'linux-x86_64\.AppImage$')"
      [ -n "$ai_url" ] || die "La versión no incluye un AppImage."
      say "Descargando $(basename "$ai_url")"
      download "$ai_url" "${tmp}/StudyTracker.AppImage"
      install_appimage "${tmp}/StudyTracker.AppImage"
      ;;
    *) die "STUDY_TRACKER_METHOD debe ser deb o appimage." ;;
  esac

  say "Instalado. Buscá \"Study Tracker\" en tu menú de aplicaciones."
}

# Everything runs from this single call, so a half-downloaded script can never execute partially.
main "$@"
