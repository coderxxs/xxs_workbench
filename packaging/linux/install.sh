#!/usr/bin/env sh
set -eu

APP_VERSION="@APP_VERSION@"
NODE_ARCHIVE="@NODE_ARCHIVE@"
NODE_DIRECTORY="@NODE_DIRECTORY@"
PYTHON_ARCHIVE="@PYTHON_ARCHIVE@"

SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET_INPUT=${1:-"$HOME/.local/share/xxs_workbench"}

case "$TARGET_INPUT" in
  ""|/) echo "Refusing unsafe installation target: $TARGET_INPUT" >&2; exit 1 ;;
esac

if [ "$(uname -s)" != "Linux" ]; then
  echo "This installer only supports Linux." >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64|amd64) ;;
  *) echo "This package requires Linux x86_64; detected $(uname -m)." >&2; exit 1 ;;
esac

for command_name in tar sha256sum mktemp; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "$command_name is required to install." >&2; exit 1; }
done

if [ ! -d "$SOURCE_DIR/runtimes" ]; then
  echo "Missing bundled runtime packages: $SOURCE_DIR/runtimes" >&2
  exit 1
fi

echo "Verifying bundled Node.js and Python packages..."
(cd "$SOURCE_DIR/runtimes" && sha256sum -c SHA256SUMS)

mkdir -p "$TARGET_INPUT"
TARGET_DIR=$(CDPATH= cd -- "$TARGET_INPUT" && pwd)
case "$TARGET_DIR" in
  ""|/) echo "Refusing unsafe resolved installation target: $TARGET_DIR" >&2; exit 1 ;;
esac

TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/xxs-workbench-install.XXXXXX")
cleanup() { rm -rf "$TEMP_DIR"; }
trap cleanup EXIT HUP INT TERM

echo "Extracting Node.js..."
mkdir -p "$TEMP_DIR/node"
tar -xJf "$SOURCE_DIR/runtimes/$NODE_ARCHIVE" -C "$TEMP_DIR/node"

echo "Extracting Python..."
mkdir -p "$TEMP_DIR/python"
tar -xzf "$SOURCE_DIR/runtimes/$PYTHON_ARCHIVE" -C "$TEMP_DIR/python"

if [ ! -x "$TEMP_DIR/node/$NODE_DIRECTORY/bin/node" ]; then
  echo "Node.js archive has an unexpected structure." >&2
  exit 1
fi
if [ ! -x "$TEMP_DIR/python/python/bin/python3" ]; then
  echo "Python archive has an unexpected structure." >&2
  exit 1
fi

if [ "$TARGET_DIR" != "$SOURCE_DIR" ]; then
  rm -rf "$TARGET_DIR/dist" "$TARGET_DIR/web"
  cp -R "$SOURCE_DIR/dist" "$SOURCE_DIR/web" "$TARGET_DIR/"
  cp "$SOURCE_DIR/package.json" "$SOURCE_DIR/VERSION" "$SOURCE_DIR/README.md" "$SOURCE_DIR/README-LINUX.md" "$SOURCE_DIR/RUNTIME-SOURCES.md" "$SOURCE_DIR/.env.example" "$SOURCE_DIR/start.sh" "$SOURCE_DIR/install.sh" "$TARGET_DIR/"
fi

mkdir -p "$TARGET_DIR/runtime" "$TARGET_DIR/data"
rm -rf "$TARGET_DIR/runtime/node" "$TARGET_DIR/runtime/python"
mkdir -p "$TARGET_DIR/runtime/node" "$TARGET_DIR/runtime/python"
cp -R "$TEMP_DIR/node/$NODE_DIRECTORY/." "$TARGET_DIR/runtime/node/"
cp -R "$TEMP_DIR/python/python/." "$TARGET_DIR/runtime/python/"
chmod +x "$TARGET_DIR/start.sh" "$TARGET_DIR/install.sh" "$TARGET_DIR/runtime/node/bin/node" "$TARGET_DIR/runtime/python/bin/python3"

NODE_VERSION=$("$TARGET_DIR/runtime/node/bin/node" --version)
PYTHON_VERSION=$("$TARGET_DIR/runtime/python/bin/python3" --version)

printf '%s\n' \
  "Installed 小小生开发工作台 $APP_VERSION to $TARGET_DIR" \
  "Bundled runtime: Node.js $NODE_VERSION; $PYTHON_VERSION" \
  "Start with: $TARGET_DIR/start.sh" \
  "Open: http://127.0.0.1:4317"
