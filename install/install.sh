#!/usr/bin/env sh
set -eu

REPO="${SPECFLOW_REPO:-DuGuYifei/Aflow}"
INSTALL_DIR="${SPECFLOW_INSTALL_DIR:-$HOME/.local/bin}"
BIN_NAME="${SPECFLOW_BIN_NAME:-specflow}"
VERSION="${SPECFLOW_VERSION:-}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "specflow installer: missing required command: $1" >&2
    exit 1
  fi
}

need curl
need tar
need uname
need mktemp

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Darwin) platform="darwin" ;;
  Linux) platform="linux" ;;
  *) echo "specflow installer: unsupported OS: $os" >&2; exit 1 ;;
esac

case "$arch" in
  arm64|aarch64) cpu="arm64" ;;
  x86_64|amd64) cpu="x64" ;;
  *) echo "specflow installer: unsupported CPU: $arch" >&2; exit 1 ;;
esac

if [ -z "$VERSION" ]; then
  VERSION="$(
    curl -fsSL "https://api.github.com/repos/$REPO/releases" |
      sed -n 's/.*"tag_name":[[:space:]]*"\(v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*[^"]*\)".*/\1/p' |
      head -n 1
  )"
fi

if [ -z "$VERSION" ]; then
  echo "specflow installer: could not resolve the latest semver release for $REPO" >&2
  exit 1
fi

asset="specflow-$platform-$cpu.tar.gz"
url="https://github.com/$REPO/releases/download/$VERSION/$asset"
tmp="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp"
}
trap cleanup EXIT INT TERM

echo "Installing Specflow $VERSION for $platform-$cpu..."
curl -fL "$url" -o "$tmp/$asset"
tar -xzf "$tmp/$asset" -C "$tmp"

mkdir -p "$INSTALL_DIR"
install_path="$INSTALL_DIR/$BIN_NAME"
mv "$tmp/specflow-$platform-$cpu" "$install_path"
chmod +x "$install_path"

echo "Specflow installed to $install_path"
if ! command -v "$BIN_NAME" >/dev/null 2>&1; then
  echo "Add $INSTALL_DIR to PATH to run '$BIN_NAME' from any shell."
fi
