#!/usr/bin/env python3
"""Emission de codes de licence SIGNES pour Budget Control (Android).

Modele a cle publique (ECDSA P-256 / SHA-256) :
- VOUS detenez la cle privee (mobile/license-private-key.pem, hors du depot).
- L'application n'embarque que la cle PUBLIQUE (dans mobile/www/js/app.js).
- Un code = un identifiant aleatoire + une SIGNATURE de cet identifiant par la
  cle privee. L'app verifie la signature avec la cle publique, hors ligne.

Consequence : personne ne peut fabriquer un code valide sans la cle privee,
meme en lisant l'app ou ce depot public. C'est la difference avec l'option
« cles generees » precedente (ou le secret etait dans l'app).

Dependance : pip install cryptography

Usage :
    python3 mobile/license-sign.py keygen           # cree la paire de cles (1re fois)
    python3 mobile/license-sign.py pubkey           # affiche la cle publique (JWK)
    python3 mobile/license-sign.py issue 20          # 20 codes signes
    python3 mobile/license-sign.py issue 20 > codes.txt
    python3 mobile/license-sign.py check <CODE>      # verifie un code
"""

import base64
import json
import os
import secrets
import sys

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import (
    decode_dss_signature, encode_dss_signature,
)
from cryptography.exceptions import InvalidSignature

HERE = os.path.dirname(os.path.abspath(__file__))
PRIVATE_KEY = os.path.join(HERE, 'license-private-key.pem')
PUBLIC_JWK = os.path.join(HERE, 'license-public-key.json')

# Doit rester identique cote application (LICENSE_PREFIX dans app.js).
PREFIX = b'BudgetControl-license-v1|'
ID_LEN = 5  # octets d'identifiant aleatoire, signes eux aussi (donc inalterables)


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def b64url_decode(s: str) -> bytes:
    s = ''.join(s.split())  # retire espaces / retours ligne
    s += '=' * (-len(s) % 4)
    return base64.urlsafe_b64decode(s)


def load_private():
    if not os.path.exists(PRIVATE_KEY):
        sys.exit("Cle privee absente. Lancez d'abord : python3 mobile/license-sign.py keygen")
    with open(PRIVATE_KEY, 'rb') as f:
        return serialization.load_pem_private_key(f.read(), password=None)


def public_jwk(pub) -> dict:
    n = pub.public_numbers()
    return {
        'kty': 'EC', 'crv': 'P-256',
        'x': b64url(n.x.to_bytes(32, 'big')),
        'y': b64url(n.y.to_bytes(32, 'big')),
    }


def cmd_keygen(argv):
    if os.path.exists(PRIVATE_KEY) and '--force' not in argv:
        sys.exit(f"{PRIVATE_KEY} existe deja. Utilisez --force pour le remplacer "
                 "(ATTENTION : invalide toutes les cles publiques deja distribuees).")
    priv = ec.generate_private_key(ec.SECP256R1())
    with open(PRIVATE_KEY, 'wb') as f:
        f.write(priv.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ))
    os.chmod(PRIVATE_KEY, 0o600)
    jwk = public_jwk(priv.public_key())
    with open(PUBLIC_JWK, 'w') as f:
        json.dump(jwk, f, indent=2)
    print(f"Cle privee ecrite : {PRIVATE_KEY}  (NE PAS COMMITTER, a sauvegarder)")
    print(f"Cle publique      : {PUBLIC_JWK}")
    print("\nCle publique a coller dans mobile/www/js/app.js (LICENSE_PUBLIC_JWK) :\n")
    print(json.dumps(jwk))


def cmd_pubkey(argv):
    print(json.dumps(public_jwk(load_private().public_key())))


def make_code(priv) -> str:
    ident = secrets.token_bytes(ID_LEN)
    der = priv.sign(PREFIX + ident, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    raw_sig = r.to_bytes(32, 'big') + s.to_bytes(32, 'big')  # format brut r||s (Web Crypto)
    return b64url(ident + raw_sig)


def cmd_issue(argv):
    priv = load_private()
    count = int(argv[0]) if argv and argv[0].isdigit() else 1
    seen = set()
    while len(seen) < count:
        seen.add(make_code(priv))
    for code in seen:
        print(code)


def verify(code: str, pub) -> bool:
    try:
        raw = b64url_decode(code)
    except Exception:
        return False
    if len(raw) != ID_LEN + 64:
        return False
    ident, raw_sig = raw[:ID_LEN], raw[ID_LEN:]
    r = int.from_bytes(raw_sig[:32], 'big')
    s = int.from_bytes(raw_sig[32:], 'big')
    try:
        pub.verify(encode_dss_signature(r, s), PREFIX + ident, ec.ECDSA(hashes.SHA256()))
        return True
    except InvalidSignature:
        return False


def cmd_check(argv):
    if not argv:
        sys.exit("Usage : license-sign.py check <CODE>")
    pub = load_private().public_key()
    ok = verify(argv[0], pub)
    print(('VALIDE   ' if ok else 'INVALIDE ') + argv[0])
    return 0 if ok else 1


def main(argv):
    if not argv:
        print(__doc__)
        return 0
    cmd, rest = argv[0], argv[1:]
    handlers = {
        'keygen': cmd_keygen, 'pubkey': cmd_pubkey,
        'issue': cmd_issue, 'check': cmd_check,
    }
    if cmd not in handlers:
        sys.exit(f"Commande inconnue : {cmd}")
    return handlers[cmd](rest) or 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
