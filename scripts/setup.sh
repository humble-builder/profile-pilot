#!/usr/bin/env sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
project_root="$(dirname -- "$script_dir")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24 or newer is required when running the installer from source." >&2
  exit 1
fi

if [ "${1:-}" = "--dev" ]; then
  node "$project_root/installer/src/cli.mjs" --dev
else
  node "$project_root/installer/src/cli.mjs"
fi
