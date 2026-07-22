# Publier la PWA sur GitHub Pages

Objectif : obtenir une **URL https** qui sert `mobile/www`, pour installer
« Budget Control » sur iPhone (Safari → « Sur l'écran d'accueil »). Une fois
installée, l'app fonctionne **hors ligne** ; l'URL ne sert qu'à l'installation
et aux mises à jour.

Tout est déjà prêt dans le dépôt :

- [`.github/workflows/deploy-pwa.yml`](../.github/workflows/deploy-pwa.yml) —
  workflow qui publie **uniquement** `mobile/www` (ni Django, ni Android).
- [`mobile/www/.nojekyll`](www/.nojekyll) — désactive tout traitement Jekyll.
- Les chemins de la PWA sont **relatifs** : elle fonctionne sous le sous-chemin
  `https://<utilisateur>.github.io/<dépôt>/` (vérifié).

## Étapes (une seule fois)

1. **Créer un dépôt GitHub** (public de préférence — Pages gratuit) puis y
   pousser ce projet. Depuis `/home/dick/App` :

   ```bash
   git remote add origin https://github.com/<utilisateur>/<dépôt>.git
   git push -u origin main
   ```

2. Sur GitHub : **Settings → Pages → Build and deployment → Source** =
   **« GitHub Actions »** (et non « Deploy from a branch »).

3. Le workflow se lance tout seul au push (ou via **Actions →
   « Deploier la PWA sur GitHub Pages » → Run workflow**). À la fin, l'URL
   s'affiche dans le job `deploy` et dans **Settings → Pages** :

   ```
   https://<utilisateur>.github.io/<dépôt>/
   ```

## Installer sur l'iPhone

1. Ouvrir cette URL dans **Safari** (pas un autre navigateur : sur iOS, seul
   Safari installe une PWA).
2. **Partager** → **Sur l'écran d'accueil** → **Ajouter**.
3. Lancer « Budget Control » depuis l'écran d'accueil. Passer en **mode avion**
   pour vérifier : l'app se charge et fonctionne sans réseau.

## Mettre à jour l'app plus tard

Modifier `mobile/www`, committer, `git push`. Le workflow redéploie
automatiquement. Le service worker est versionné (`budget-control-v1` dans
[`sw.js`](www/sw.js)) : pour forcer les appareils déjà installés à récupérer une
nouvelle version, incrémenter ce nom de cache (`-v2`, `-v3`, …).

## Notes

- **iOS et le manifeste** : l'installation iOS s'appuie surtout sur les balises
  `apple-touch-icon` et `apple-mobile-web-app-*` de `index.html`. Le
  `manifest.webmanifest` complète (nom, icônes) ; même si GitHub servait son
  type MIME de façon imparfaite, l'ajout à l'écran d'accueil fonctionne.
- **Confidentialité** : héberger `mobile/www` ne publie que l'application
  (fichiers statiques), **jamais vos données** — elles restent en local sur
  l'appareil (IndexedDB), rien n'est envoyé nulle part.
- **Alternative sans GitHub** : n'importe quel hébergement statique https
  convient (Netlify, Cloudflare Pages, un serveur perso avec certificat). Il
  suffit d'y déposer le contenu de `mobile/www`.
