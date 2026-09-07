#!/usr/bin/env bash
set -euo pipefail

echo "=== Uninstalling Desktop Integration for Aspect Chat ==="

BIN_DIR="${HOME}/.local/bin"
APPS_DIR="${HOME}/.local/share/applications"
DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || echo "${HOME}/Desktop")"
ICONS_DIR="${HOME}/.local/share/icons/hicolor/scalable/apps"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/aspect-chat"
LAUNCHER="${BIN_DIR}/aspect-chat"

if [ -x "${LAUNCHER}" ]; then
    echo ""
    echo "Stopping the local server (if running)…"
    "${LAUNCHER}" --stop 2>/dev/null || true
fi

echo ""
echo "Removing launcher:        ${LAUNCHER}"
rm -f "${LAUNCHER}"

echo "Removing menu entry:      ${APPS_DIR}/aspect-chat.desktop"
rm -f "${APPS_DIR}/aspect-chat.desktop"

if [ -d "${DESKTOP_DIR}" ]; then
    echo "Removing desktop shortcut: ${DESKTOP_DIR}/aspect-chat.desktop"
    rm -f "${DESKTOP_DIR}/aspect-chat.desktop"
fi

echo "Removing icon:            ${ICONS_DIR}/aspect-chat.svg"
rm -f "${ICONS_DIR}/aspect-chat.svg"

echo "Removing state dir:       ${STATE_DIR}"
rm -rf "${STATE_DIR}"

if command -v update-desktop-database >/dev/null 2>&1; then
    echo ""
    echo "Updating desktop database…"
    update-desktop-database "${APPS_DIR}" 2>/dev/null || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    echo "Updating icon cache…"
    gtk-update-icon-cache -f -t "${HOME}/.local/share/icons/hicolor" 2>/dev/null || true
fi

echo ""
echo "======================================================"
echo " Aspect Chat desktop integration uninstalled!"
echo "======================================================"
