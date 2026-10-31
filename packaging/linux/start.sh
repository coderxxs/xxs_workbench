#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DATA_DIR=${DEV_AGENT_HOME:-"$ROOT_DIR/data"}
NODE_BIN=${DEV_AGENT_NODE:-"$ROOT_DIR/runtime/node/bin/node"}
PYTHON_BIN=${DEV_AGENT_PYTHON:-"$ROOT_DIR/runtime/python/bin/python3"}

if [ ! -x "$NODE_BIN" ] || [ ! -x "$PYTHON_BIN" ]; then
  echo "Bundled Node.js/Python runtime is not installed. Run: $ROOT_DIR/install.sh $ROOT_DIR" >&2
  exit 1
fi

export DEV_AGENT_HOME="$DATA_DIR"
export DEV_AGENT_HOST=${DEV_AGENT_HOST:-127.0.0.1}
export DEV_AGENT_PORT=${DEV_AGENT_PORT:-4317}
export DEV_AGENT_PYTHON="$PYTHON_BIN"
mkdir -p "$DATA_DIR"
cd "$ROOT_DIR"
exec "$NODE_BIN" dist/src/server.js
