#!/usr/bin/env bash
# Local-clone compatibility entry point. The Node CLI owns all install behavior.

set -euo pipefail

KIT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
exec node "${KIT_ROOT}/bin/factory-kit.js" install --target claude "$@"
