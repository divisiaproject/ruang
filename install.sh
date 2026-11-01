#!/usr/bin/env bash
# Ruang (Hermes 3D Virtual Office) installer for macOS, Linux and WSL2.
#
#   curl -fsSL https://raw.githubusercontent.com/divisiaproject/ruang/main/install.sh | bash
#
# Installs the latest release into ~/.local/share/ruang and a `ruang` command into
# ~/.local/bin. Nothing is installed system-wide and sudo is never used. If no
# suitable Node.js (20+) is found, a private copy is downloaded for Ruang only.
# Run it again to update. Options (pass them after `bash -s --` when piping):
#
#   --service        also run it as a systemd user service (Linux)
#   --from-source    build from the main branch instead of installing a release (needs git)
#   --version <tag>  install a specific release, for example v0.2.0
#   --tarball <path> install a local or downloaded package (.tgz) instead of a release
#   --uninstall      remove it, its service and its private Node.js
#   -h, --help       show this help
#
# Environment: RUANG_HOME (install folder), RUANG_BIN (command folder).

set -euo pipefail

REPO="divisiaproject/ruang"
PACKAGE="ruang"
COMMAND="ruang"
NODE_MAJOR_MIN=20
NODE_MAJOR_PRIVATE=22
INSTALL_HOME="${RUANG_HOME:-$HOME/.local/share/ruang}"
BIN_DIR="${RUANG_BIN:-$HOME/.local/bin}"
SERVICE_NAME="ruang"
SERVICE_FILE="$HOME/.config/systemd/user/$SERVICE_NAME.service"
WORK=""
export NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
fail() { printf '\033[31mx %s\033[0m\n' "$*" >&2; exit 1; }

usage() {
  cat <<'HELP'
Ruang · Hermes 3D Virtual Office installer (macOS, Linux, WSL2)

  curl -fsSL https://raw.githubusercontent.com/divisiaproject/ruang/main/install.sh | bash
  curl -fsSL .../install.sh | bash -s -- --service

Options:
  --service        also run it as a systemd user service (Linux)
  --from-source    build from the main branch instead of installing a release (needs git)
  --version <tag>  install a specific release, for example v0.2.0
  --tarball <path> install a local or downloaded package (.tgz) instead of a release
  --uninstall      remove it, its service and its private Node.js
  -h, --help       show this help

Environment: RUANG_HOME (install folder), RUANG_BIN (command folder).
HELP
}

need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required but not installed."; }

download() { # url destination
  curl -fsSL --retry 3 --proto '=https' --tlsv1.2 -o "$2" "$1"
}

node_major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

# Prints the node binary to use, downloading a private Node.js when needed.
ensure_node() {
  local system_node
  system_node="$(command -v node || true)"
  if [ -n "$system_node" ] && [ "$(node_major "$system_node")" -ge "$NODE_MAJOR_MIN" ]; then
    printf '%s\n' "$system_node"
    return
  fi
  local private="$INSTALL_HOME/node/bin/node"
  if [ -x "$private" ] && [ "$(node_major "$private")" -ge "$NODE_MAJOR_MIN" ]; then
    printf '%s\n' "$private"
    return
  fi

  local os arch
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) fail "Unsupported system $(uname -s). On Windows, run this inside WSL2." ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) fail "Unsupported CPU $(uname -m) for the bundled Node.js; install Node.js $NODE_MAJOR_MIN+ yourself and rerun." ;;
  esac

  info "Node.js $NODE_MAJOR_MIN+ not found; downloading a private Node.js $NODE_MAJOR_PRIVATE for Ruang..." >&2
  local base="https://nodejs.org/dist/latest-v$NODE_MAJOR_PRIVATE.x"
  local work sums file
  work="$(mktemp -d)"
  download "$base/SHASUMS256.txt" "$work/SHASUMS256.txt"
  file="$(awk -v suffix="-$os-$arch.tar.gz" '$2 ~ suffix"$" { print $2; exit }' "$work/SHASUMS256.txt")"
  [ -n "$file" ] || fail "No Node.js build for $os-$arch."
  download "$base/$file" "$work/$file"
  sums="$(grep " $file\$" "$work/SHASUMS256.txt")"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$work" && printf '%s\n' "$sums" | sha256sum -c - >/dev/null) || fail "Node.js checksum mismatch."
  else
    (cd "$work" && printf '%s\n' "$sums" | shasum -a 256 -c - >/dev/null) || fail "Node.js checksum mismatch."
  fi
  rm -rf "$INSTALL_HOME/node"
  mkdir -p "$INSTALL_HOME/node"
  tar -xzf "$work/$file" -C "$INSTALL_HOME/node" --strip-components=1
  rm -rf "$work"
  printf '%s\n' "$private"
}

# Prints the path of a package tarball to install (release, local file or source build).
fetch_package() {
  local node_bin="$1" mode="$2" version="$3" tarball="$4" work="$5"
  if [ -n "$tarball" ]; then
    case "$tarball" in
      https://*) download "$tarball" "$work/package.tgz" ;;
      *) [ -f "$tarball" ] || fail "No such file: $tarball"; cp "$tarball" "$work/package.tgz" ;;
    esac
    printf '%s\n' "$work/package.tgz"
    return
  fi
  if [ "$mode" = release ]; then
    local url="https://github.com/$REPO/releases/latest/download/$PACKAGE.tgz"
    [ -n "$version" ] && url="https://github.com/$REPO/releases/download/$version/$PACKAGE.tgz"
    if download "$url" "$work/package.tgz" 2>/dev/null; then
      printf '%s\n' "$work/package.tgz"
      return
    fi
    [ -n "$version" ] && fail "Release $version not found."
    warn "No release published yet; building from source instead."
  fi

  need git
  local src="$INSTALL_HOME/src" npm_cli
  npm_cli="$(dirname "$node_bin")/npm"
  if [ -d "$src/.git" ]; then
    info "Updating the source checkout..." >&2
    git -C "$src" fetch --quiet --depth 1 origin main
    git -C "$src" reset --quiet --hard origin/main
  else
    info "Cloning $REPO..." >&2
    rm -rf "$src"
    git clone --quiet --depth 1 "https://github.com/$REPO.git" "$src"
  fi
  info "Building (this takes a minute or two)..." >&2
  (cd "$src" && PATH="$(dirname "$node_bin"):$PATH" "$npm_cli" ci --no-audit --no-fund --loglevel=error >&2 \
    && PATH="$(dirname "$node_bin"):$PATH" "$npm_cli" run --silent build >&2 \
    && PATH="$(dirname "$node_bin"):$PATH" "$npm_cli" pack --silent --pack-destination "$work" >/dev/null)
  ls "$work"/"$PACKAGE"-*.tgz | head -n 1
}

write_launcher() {
  local node_bin="$1"
  mkdir -p "$BIN_DIR"
  cat > "$BIN_DIR/$COMMAND" <<LAUNCHER
#!/bin/sh
# Installed by the Ruang installer; rerun the installer to update.
exec "$node_bin" "$INSTALL_HOME/app/lib/node_modules/$PACKAGE/bin/$COMMAND.js" "\$@"
LAUNCHER
  chmod +x "$BIN_DIR/$COMMAND"
}

install_service() {
  if [ "$(uname -s)" != Linux ] || ! command -v systemctl >/dev/null 2>&1 || ! systemctl --user show-environment >/dev/null 2>&1; then
    warn "--service needs systemd user services (Linux). Start it with: $COMMAND"
    return
  fi
  mkdir -p "$(dirname "$SERVICE_FILE")"
  # systemd starts services with a minimal PATH; keep the current one so `hermes` is found.
  cat > "$SERVICE_FILE" <<UNIT
[Unit]
Description=Ruang, Hermes 3D Virtual Office (read-only mission control)
After=network.target

[Service]
ExecStart=$BIN_DIR/$COMMAND
Environment=PATH=$PATH
Restart=on-failure

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now "$SERVICE_NAME" >/dev/null 2>&1
  systemctl --user restart "$SERVICE_NAME"
  info "Service $SERVICE_NAME is running (systemctl --user status $SERVICE_NAME)."
  info "To keep it running after you log out: loginctl enable-linger $USER"
}

# Removes installs made under the project's previous names (Mission Control, PT AI Maju Jaya).
remove_previous_names() {
  local old_command folder
  for entry in "mission-control:mission-control:Mission Control installer" "majujaya:pt-ai-maju-jaya:PT AI Maju Jaya installer"; do
    old_command="${entry%%:*}"
    folder="${entry#*:}"; folder="${folder%%:*}"
    local marker="${entry##*:}" launcher="$BIN_DIR/$old_command" unit="$HOME/.config/systemd/user/$old_command.service"
    [ -f "$launcher" ] && grep -q "$marker" "$launcher" 2>/dev/null || continue
    if [ -f "$unit" ] && command -v systemctl >/dev/null 2>&1; then
      systemctl --user disable --now "$old_command" >/dev/null 2>&1 || true
      rm -f "$unit"
      systemctl --user daemon-reload >/dev/null 2>&1 || true
    fi
    rm -rf "$HOME/.local/share/$folder"
    rm -f "$launcher"
    info "Removed the previous install under the old name ($old_command); the project is now Ruang."
  done
}

uninstall() {
  bold "Removing Ruang"
  if [ -f "$SERVICE_FILE" ] && command -v systemctl >/dev/null 2>&1; then
    systemctl --user disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
    rm -f "$SERVICE_FILE"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
  fi
  rm -rf "$INSTALL_HOME"
  rm -f "$BIN_DIR/$COMMAND"
  info "Removed $INSTALL_HOME and $BIN_DIR/$COMMAND."
  remove_previous_names
}

main() {
  local mode=release version="" tarball="" service=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --service) service=1 ;;
      --from-source) mode=source ;;
      --version) version="${2:-}"; [ -n "$version" ] || fail "--version needs a tag, for example v0.2.0"; shift ;;
      --tarball) tarball="${2:-}"; [ -n "$tarball" ] || fail "--tarball needs a path"; shift ;;
      --uninstall) uninstall; return ;;
      -h | --help) usage; return ;;
      *) fail "Unknown option: $1 (see --help)" ;;
    esac
    shift
  done

  bold "Installing Ruang · Hermes 3D Virtual Office"
  need curl
  need tar
  mkdir -p "$INSTALL_HOME"

  local node_bin npm_cli package
  node_bin="$(ensure_node)"
  npm_cli="$(dirname "$node_bin")/npm"
  [ -x "$npm_cli" ] || npm_cli="$(command -v npm || true)"
  [ -n "$npm_cli" ] || fail "npm was not found next to $node_bin."
  info "Using Node.js $("$node_bin" --version) at $node_bin"

  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
  package="$(fetch_package "$node_bin" "$mode" "$version" "$tarball" "$WORK")"

  info "Installing the package..."
  rm -rf "$INSTALL_HOME/app"
  PATH="$(dirname "$node_bin"):$PATH" "$npm_cli" install --global --prefix "$INSTALL_HOME/app" \
    --omit=dev --no-audit --no-fund --loglevel=error "$package" >/dev/null
  write_launcher "$node_bin"
  remove_previous_names

  local installed
  installed="$("$BIN_DIR/$COMMAND" --version)"
  bold "Ruang $installed installed."

  if ! command -v hermes >/dev/null 2>&1; then
    warn "The Hermes CLI (hermes) is not on your PATH. Ruang reads everything through it; install Hermes Agent first."
  fi
  if [ "$service" = 1 ]; then
    install_service
  elif [ -f "$SERVICE_FILE" ] && command -v systemctl >/dev/null 2>&1; then
    systemctl --user restart "$SERVICE_NAME" >/dev/null 2>&1 && info "Restarted the $SERVICE_NAME service."
  fi

  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) warn "$BIN_DIR is not on your PATH. Add it, for example: echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.bashrc" ;;
  esac
  echo
  info "Start it:   $COMMAND        (or $COMMAND --port 3005)"
  info "Open:       http://127.0.0.1:3001"
  info "On a server, forward the port from your laptop: ssh -L 3001:127.0.0.1:3001 $USER@<server>"
  info "Update:     run this installer again.   Remove: add --uninstall"
}

main "$@"
