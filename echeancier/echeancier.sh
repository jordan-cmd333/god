#!/usr/bin/env bash
# Lanceur : utilise le venv du depot s'il existe, sinon le python du systeme.
set -euo pipefail
racine="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python="$racine/../venv/bin/python"
[ -x "$python" ] || python="$(command -v python3)"
# On ne change pas de repertoire courant : les chemins relatifs passes en
# argument restent ceux de l'utilisateur.
exec env PYTHONPATH="$racine${PYTHONPATH:+:$PYTHONPATH}" "$python" -m echeancier "$@"
