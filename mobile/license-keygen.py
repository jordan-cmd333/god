#!/usr/bin/env python3
"""Generateur de cles de licence pour Budget Control (Android).

Produit des cles au format BC-XXXXX-XXXXX-CCCCC que l'application valide HORS
LIGNE : les deux premiers groupes sont le numero de serie (aleatoire), le
dernier une somme de controle derivee par SHA-256 d'un secret partage.

IMPORTANT : le meme secret et le meme algorithme sont dans
mobile/www/js/app.js (LICENSE_SECRET / LICENSE_ALPHABET / licenseChecksum).
Si vous changez le secret ici, changez-le aussi la-bas, puis republiez l'APK.

Limite assumee : le secret etant present dans l'app distribuee, une personne
technique peut le retrouver et fabriquer des cles. C'est un verrou dissuasif.

Usage :
    python3 mobile/license-keygen.py            # 1 cle
    python3 mobile/license-keygen.py 20         # 20 cles
    python3 mobile/license-keygen.py 20 > cles.txt
    python3 mobile/license-keygen.py --check BC-1A2B3-4C5D6-XXXXX   # verifier
"""

import hashlib
import secrets
import sys

# --- Doit rester identique a mobile/www/js/app.js -------------------------
LICENSE_SECRET = 'BudgetControl::licence::v1::7bQ9-kZ2r-Nf5T'
ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'  # base32 sans I L O U


def checksum(payload: str) -> str:
    d = hashlib.sha256((LICENSE_SECRET + ':' + payload).encode()).digest()
    n = d[0] * 16777216 + d[1] * 65536 + d[2] * 256 + d[3]
    n25 = n >> 7  # 25 bits de poids fort
    return ''.join(ALPHABET[(n25 >> (5 * (4 - i))) & 31] for i in range(5))


def group() -> str:
    return ''.join(secrets.choice(ALPHABET) for _ in range(5))


def make_key() -> str:
    g1, g2 = group(), group()
    payload = f'BC-{g1}-{g2}'
    return f'{payload}-{checksum(payload)}'


def normalize(raw: str) -> str:
    s = raw.upper().replace('O', '0').replace('I', '1').replace('L', '1')
    return ''.join(c for c in s if c in ALPHABET or c.isdigit())


def is_valid(raw: str) -> bool:
    s = normalize(raw)
    if len(s) != 17 or s[:2] != 'BC':
        return False
    g1, g2, ck = s[2:7], s[7:12], s[12:17]
    if any(c not in ALPHABET for c in g1 + g2 + ck):
        return False
    return checksum(f'BC-{g1}-{g2}') == ck


def main(argv):
    if argv and argv[0] == '--check':
        key = argv[1] if len(argv) > 1 else ''
        ok = is_valid(key)
        print(('VALIDE  ' if ok else 'INVALIDE ') + key)
        return 0 if ok else 1

    count = int(argv[0]) if argv and argv[0].isdigit() else 1
    seen = set()
    while len(seen) < count:
        seen.add(make_key())
    for key in seen:
        print(key)
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
