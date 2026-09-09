#!/bin/bash
# Compatibility entrypoint: structural + semantic validation, not PR readiness.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/validation-gate.mjs" check "$@"
