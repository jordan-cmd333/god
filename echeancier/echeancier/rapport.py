"""Mise en forme des alertes : console, resume court, page HTML."""

from __future__ import annotations

import html
from datetime import date

from .modele import Alerte, Tache

PUCES = {"retard": "!!", "aujourd'hui": "->"}


def _puce(alerte: Alerte) -> str:
    return PUCES.get(alerte.palier, "..")


def texte_console(alertes: list[Alerte], aujourdhui: date, titre: str) -> str:
    if not alertes:
        return f"{titre} — {aujourdhui:%d/%m/%Y} : aucune echeance proche."

    retards = [a for a in alertes if a.en_retard]
    jour = [a for a in alertes if a.jours == 0]
    proches = [a for a in alertes if a.jours > 0]

    lignes = [f"{titre} — {aujourdhui:%d/%m/%Y}", "=" * 60]
    for entete, groupe in (
        ("EN RETARD", retards),
        ("AUJOURD'HUI", jour),
        ("A VENIR", proches),
    ):
        if not groupe:
            continue
        lignes.append("")
        lignes.append(f"{entete} ({len(groupe)})")
        for alerte in groupe:
            tache = alerte.tache
            details = [f"{tache.feuille}!L{tache.ligne}"]
            if tache.responsable:
                details.append(tache.responsable)
            if tache.statut:
                details.append(tache.statut)
            lignes.append(
                f"  {_puce(alerte)} {tache.libelle}  "
                f"[{tache.echeance:%d/%m/%Y} · {_delai(alerte.jours)}]"
            )
            lignes.append(f"       {' · '.join(details)}")
    lignes.append("")
    lignes.append(f"{len(alertes)} tache(s) a surveiller.")
    return "\n".join(lignes)


def _delai(jours: int) -> str:
    if jours < 0:
        return f"retard {abs(jours)} j"
    if jours == 0:
        return "aujourd'hui"
    if jours == 1:
        return "demain"
    return f"J-{jours}"


def resume_court(alertes: list[Alerte], limite: int = 4) -> str:
    """Corps d'une notification de bureau : concis, quelques lignes au plus."""
    lignes = [f"{_delai(a.jours)} · {a.tache.libelle}" for a in alertes[:limite]]
    reste = len(alertes) - limite
    if reste > 0:
        lignes.append(f"… et {reste} autre(s)")
    return "\n".join(lignes)


def titre_court(alertes: list[Alerte], titre: str) -> str:
    retards = sum(1 for a in alertes if a.en_retard)
    if retards:
        return f"{titre} : {retards} en retard, {len(alertes)} a traiter"
    return f"{titre} : {len(alertes)} echeance(s) proche(s)"


def page_html(
    alertes: list[Alerte],
    aujourdhui: date,
    titre: str,
    sans_date: list[Tache] | None = None,
) -> str:
    e = html.escape
    lignes = []
    for alerte in alertes:
        tache = alerte.tache
        classe = "retard" if alerte.en_retard else ("jour" if alerte.jours == 0 else "proche")
        lignes.append(
            "<tr class='{c}'><td class='delai'>{d}</td><td>{lib}</td>"
            "<td>{ech}</td><td>{resp}</td><td>{st}</td>"
            "<td class='src'>{f} · ligne {l}</td></tr>".format(
                c=classe,
                d=e(_delai(alerte.jours)),
                lib=e(tache.libelle),
                ech=f"{tache.echeance:%d/%m/%Y}",
                resp=e(tache.responsable) or "—",
                st=e(tache.statut) or "—",
                f=e(tache.feuille),
                l=tache.ligne,
            )
        )
    corps = "".join(lignes) or (
        "<tr><td colspan='6' class='vide'>Aucune echeance proche.</td></tr>"
    )

    bloc_sans_date = ""
    if sans_date:
        items = "".join(
            f"<li>{e(t.libelle)} <span class='src'>({e(t.feuille)} · ligne {t.ligne})</span></li>"
            for t in sans_date[:30]
        )
        bloc_sans_date = (
            "<h2>Lignes sans date limite lisible</h2>"
            f"<ul class='sansdate'>{items}</ul>"
        )

    return f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(titre)}</title>
<style>
:root {{ color-scheme: light dark; --fond:#fbfaf8; --carte:#fff; --texte:#1b1b1a;
  --doux:#6b6a67; --trait:#e5e2dc; --retard:#b3261e; --jour:#a15c00; --proche:#2f6b4f; }}
@media (prefers-color-scheme: dark) {{ :root {{ --fond:#17181a; --carte:#1f2124;
  --texte:#eceae6; --doux:#9d9b96; --trait:#33363b; --retard:#ff8a80; --jour:#ffc46b;
  --proche:#8fd3ae; }} }}
* {{ box-sizing:border-box; }}
body {{ margin:0; padding:24px; background:var(--fond); color:var(--texte);
  font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }}
main {{ max-width:960px; margin:0 auto; }}
h1 {{ font-size:22px; margin:0 0 4px; }}
p.date {{ color:var(--doux); margin:0 0 20px; }}
.tableau {{ overflow-x:auto; background:var(--carte); border:1px solid var(--trait);
  border-radius:10px; }}
table {{ width:100%; border-collapse:collapse; }}
th, td {{ text-align:left; padding:10px 12px; border-bottom:1px solid var(--trait); }}
th {{ font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--doux); }}
tr:last-child td {{ border-bottom:none; }}
.delai {{ font-weight:600; white-space:nowrap; }}
tr.retard .delai {{ color:var(--retard); }}
tr.jour .delai {{ color:var(--jour); }}
tr.proche .delai {{ color:var(--proche); }}
.src, .vide {{ color:var(--doux); font-size:13px; }}
.vide {{ text-align:center; padding:28px; }}
h2 {{ font-size:15px; margin:28px 0 8px; }}
ul.sansdate {{ margin:0; padding-left:20px; color:var(--doux); }}
</style></head>
<body><main>
<h1>{e(titre)}</h1>
<p class="date">Etat au {aujourdhui:%d/%m/%Y} — {len(alertes)} tache(s) a surveiller</p>
<div class="tableau"><table>
<thead><tr><th>Delai</th><th>Tache</th><th>Echeance</th><th>Responsable</th>
<th>Statut</th><th>Source</th></tr></thead>
<tbody>{corps}</tbody>
</table></div>
{bloc_sans_date}
</main></body></html>
"""
