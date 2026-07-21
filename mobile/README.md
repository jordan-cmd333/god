# Budget Control — version Android hors ligne

Application **100 % hors ligne**, empaquetée en APK, **sans aucune permission**
(notamment pas de `INTERNET`). Elle ne peut techniquement pas accéder au réseau,
même téléphone connecté. Fonctionne à l'identique en mode avion.

C'est une **réécriture côté client** de l'application Django : toute la logique
métier (périodes, agrégations, alertes, solde, dépassement des revenus,
rapports) a été portée en JavaScript, et les données sont stockées en
**IndexedDB** sur l'appareil. Aucun serveur, aucun appel API.

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
