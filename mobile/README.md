# Budget Control — version mobile hors ligne

Application **100 % hors ligne** : toute la logique métier (périodes,
agrégations, alertes, solde, dépassement des revenus, rapports) est portée en
JavaScript et les données vivent en **IndexedDB** sur l'appareil. Aucun serveur,
aucun appel réseau.

Deux emballages partagent le **même code** (`mobile/www`) :

- **Android** : APK **sans aucune permission** (pas d'`INTERNET`) — voir
  [« APK Android »](#apk-android) plus bas.
- **iOS (et Android)** : **PWA** installable via « Sur l'écran d'accueil » — voir
  [« Installer sur iOS (PWA) »](#installer-sur-ios-pwa) juste en dessous.

## Installer sur iOS (PWA)

iOS n'autorise pas la compilation d'une app hors d'un Mac + Xcode + compte Apple
Developer. La voie sans Mac est donc la **Progressive Web App** : l'app s'ajoute
à l'écran d'accueil, s'ouvre en plein écran et fonctionne hors ligne grâce à un
*service worker* qui met tous les fichiers en cache.

À noter : iOS n'a pas de « permission Internet » à retirer comme Android. La
garantie « aucun réseau » tient au fait que l'app **n'émet aucune requête** (tout
est local) — une fois installée, elle se sert entièrement de son cache.

### Étapes

1. **Héberger `mobile/www` sur une URL https.** L'installation d'une PWA exige
   https (contrainte des navigateurs). C'est nécessaire **uniquement pour
   l'installation** ; ensuite l'app tourne hors ligne. Config GitHub Pages prête
   à l'emploi : voir [`DEPLOY-github-pages.md`](DEPLOY-github-pages.md) (workflow
   qui publie automatiquement `mobile/www`). Tout autre hébergement statique
   https convient aussi (Netlify, Cloudflare Pages…).
2. Sur l'iPhone, ouvrir cette URL dans **Safari**.
3. Bouton **Partager** → **Sur l'écran d'accueil** → **Ajouter**.
4. Lancer « Budget Control » depuis l'écran d'accueil : plein écran, hors ligne.
   Activer le **mode avion** pour vérifier — l'app se charge et fonctionne.

Fichiers PWA : [`manifest.webmanifest`](www/manifest.webmanifest) (nom, icônes,
`display: standalone`), [`sw.js`](www/sw.js) (précache + réponse « cache
d'abord »), balises Apple dans [`index.html`](www/index.html), icônes dans
[`www/icons/`](www/icons). Le service worker est **désactivé dans l'APK Android**
(origine `appassets.local`), qui sert déjà tout en local.

Vérifié ici : manifeste valide, service worker enregistré et actif, 13 fichiers
précachés, et **chargement complet de l'application serveur coupé** (donc hors
ligne). L'installation réelle sur un iPhone est l'étape que vous validez.

## APK Android

C'est une **réécriture côté client** de l'application Django, empaquetée dans une
WebView **sans aucune permission**. Fonctionne à l'identique en mode avion.

## Architecture

```
mobile/
├── www/                     ← l'application (HTML/CSS/JS pur, aucune dépendance)
│   ├── index.html
│   ├── css/app.css
│   └── js/
│       ├── db.js            ← couche IndexedDB
│       ├── services.js      ← règles de gestion (port de budget/services.py)
│       ├── seed.js          ← catégories / sources par défaut
│       ├── charts.js        ← graphiques en canvas natif
│       └── app.js           ← routeur + toutes les pages
└── android/                 ← coquille WebView minimale (sans AndroidX)
    ├── app/src/main/
    │   ├── AndroidManifest.xml           ← AUCUNE permission
    │   ├── java/.../MainActivity.java
    │   ├── java/.../AssetWebViewClient.java
    │   └── res/…
    └── build_apk.sh          ← build manuel aapt2 → javac → d8 → zipalign → apksigner
```

### Intégration Android (limites d'une WebView)

Une WebView nue ignore certaines API web. Trois ponts sont donc en place, tous
sans permission ni réseau :

- **Confirmations** : `window.confirm()` renvoie toujours `false` dans une
  WebView sans `WebChromeClient`, ce qui bloquait toutes les suppressions
  (limite, dépense, catégorie…). Remplacé par une boîte de dialogue **interne**
  à l'application (indépendante de la WebView).
- **Import de sauvegarde** : `<input type="file">` nécessite
  `onShowFileChooser` (fourni par `AppChromeClient`) — via le sélecteur système,
  sans permission de stockage.
- **Exports & impression** : le téléchargement de *blob* n'existe pas en
  WebView. Un pont `AndroidBridge` enregistre les fichiers (CSV, JSON) via le
  Storage Access Framework et lance l'impression / PDF via le service système.
  Côté web, repli automatique sur le téléchargement navigateur.

### Pourquoi zéro permission fonctionne

Les fichiers de `assets/www` sont servis à la WebView via une origine virtuelle
`https://appassets.local/`, **interceptée en interne** par `AssetWebViewClient`
(`shouldInterceptRequest`). Aucun socket réseau n'est ouvert — c'est pourquoi la
permission `INTERNET` est inutile. L'origine `https` fournit un *contexte
sécurisé*, requis pour qu'IndexedDB soit stable dans la WebView.

## Construire l'APK

Nécessite un JDK (17+) et un SDK Android avec une plateforme + build-tools 34
(`android.jar`, `aapt2`, `d8`, `zipalign`, `apksigner`).

```bash
export ANDROID_SDK=$HOME/android-sdk     # si différent du défaut
bash mobile/android/build_apk.sh
```

Produit `mobile/android/budget-control.apk`, signé avec un keystore de debug
(créé au premier build). Le script n'utilise pas Gradle : pipeline manuel
`aapt2 → javac → d8 → zipalign → apksigner`.

## Installer et tester en mode avion

```bash
adb install -r mobile/android/budget-control.apk
```

ou copier l'APK sur le téléphone et l'ouvrir (autoriser « sources inconnues »).

1. Activer le **mode avion**.
2. Ouvrir Budget Control : le tableau de bord s'affiche, les données saisies
   sont conservées entre les lancements (IndexedDB).
3. Paramètres → « Charger 90 jours de données de démo » pour voir l'app remplie.

Vérifications déjà effectuées : le manifeste ne déclare **aucune**
`uses-permission`, l'APK embarque le code de l'app + `classes.dex`, la signature
est valide, et aucun fichier JS ne contient d'appel réseau (`fetch`, `XHR`,
`WebSocket`) ni d'URL externe.

## Écarts assumés par rapport à la version Django

- **Authentification** : la connexion multi-utilisateur serveur n'a pas de sens
  sur un appareil personnel hors ligne. Remplacée par un **verrou PIN local
  optionnel** (Paramètres). C'est un verrou de confort : les données ne sont pas
  chiffrées — un accès physique à l'appareil permet de les lire de toute façon.
- **Exports** : `reportlab`/`openpyxl` étaient côté serveur (Python). Remplacés,
  sans dépendance et hors ligne, par un **export CSV** (ouvrable dans Excel) et
  une **impression / PDF** via la fonction d'impression du système.
- **Sauvegarde** : export/import **JSON** de toutes les données (Paramètres),
  pour transférer ou sauvegarder sans réseau.
- **Données** : locales à l'appareil. Le code Django et sa base restent le
  projet serveur ; cette version mobile est autonome.

## Limite de vérification

L'APK a été construit, signé et inspecté ici (zéro permission, assets et dex
présents, signature valide), et la logique de l'application a été testée de bout
en bout dans un navigateur Chromium (le moteur de la WebView). Elle **n'a pas
été exécutée sur un appareil ou un émulateur Android réel** dans cet
environnement — c'est l'étape que vous validez à l'installation.
