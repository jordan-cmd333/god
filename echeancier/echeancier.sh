#!/usr/bin/env bash
# Lanceur Linux / macOS : cherche un venv a cote de l'outil, puis a la racine du
# depot, et retombe sur le python du systeme.
set -euo pipefail
racine="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for candidat in "$racine/venv/bin/python" "$racine/../venv/bin/python"; do
    if [ -x "$candidat" ]; then python="$candidat"; break; fi
done
python="${python:-$(command -v python3)}"

# On ne change pas de repertoire courant : les chemins relatifs passes en
# argument restent ceux de l'utilisateur.
exec env PYTHONPATH="$racine${PYTHONPATH:+:$PYTHONPATH}" "$python" -m echeancier "$@"
