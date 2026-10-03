#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
bash -n "${SCRIPT_DIR}/aspect-chat-install.sh"
bash -n "${SCRIPT_DIR}/aspect-chat-uninstall.sh"
launcher_tmp="$(mktemp)"
verify_state="$(mktemp -d)"
trap 'rm -f "${launcher_tmp}"; rmdir "${verify_state}/aspect-chat" "${verify_state}"' EXIT
awk '/^cat > "\$\{LAUNCHER\}" <<.*EOF/ { copying=1; next } copying && /^EOF$/ { exit } copying { print }' "${SCRIPT_DIR}/aspect-chat-install.sh" > "${launcher_tmp}"
test -s "${launcher_tmp}"
bash -n "${launcher_tmp}"
XDG_STATE_HOME="${verify_state}" bash "${launcher_tmp}" --help
XDG_STATE_HOME="${verify_state}" bash "${launcher_tmp}" --status
