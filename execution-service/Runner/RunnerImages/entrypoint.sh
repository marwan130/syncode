#!/bin/sh
set -eu

if [ "$#" -ne 0 ]; then
  printf '%s\n' 'Runner images do not accept command arguments.' >&2
  exit 64
fi

case "${RUNNER_RUNTIME:-}" in
  node)
    runtime=node
    code_file=/workspace/main.js
    ;;
  python)
    runtime=python3
    code_file=/workspace/main.py
    ;;
  *)
    printf '%s\n' 'RUNNER_RUNTIME must be node or python.' >&2
    exit 64
    ;;
esac

if [ ! -f "$code_file" ] || [ ! -r "$code_file" ]; then
  printf '%s\n' 'The mounted source file is missing or unreadable.' >&2
  exit 66
fi

exec "$runtime" "$code_file"
