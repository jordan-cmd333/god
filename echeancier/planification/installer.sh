#!/usr/bin/env bash
# Installe la verification automatique (timer systemd utilisateur, sans sudo).
set -euo pipefail
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cible="$HOME/.config/systemd/user"

mkdir -p "$cible"
sed "s|%h/App/echeancier|$(dirname "$source_dir")|" \
    "$source_dir/echeancier.service" > "$cible/echeancier.service"
cp "$source_dir/echeancier.timer" "$cible/echeancier.timer"

systemctl --user daemon-reload
systemctl --user enable --now echeancier.timer

echo "Timer installe. Prochaine execution :"
systemctl --user list-timers echeancier.timer --no-pager
echo
echo "Journal      : journalctl --user -u echeancier.service -n 50"
echo "Desinstaller : systemctl --user disable --now echeancier.timer"
