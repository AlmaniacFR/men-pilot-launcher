# MEN Pilot Launcher 2.0

Cockpit desktop Windows indépendant du code métier MEN Pilot.

## Ce que la V2 ajoute

- démarrage / arrêt / redémarrage PostgreSQL, Spring Boot et Angular ;
- état réel des ports et détection des processus externes ;
- health checks HTTP (`/actuator/health` et frontend) ;
- logs consolidés et historique persistant ;
- dashboard Git : branche, commit, working tree et fichiers modifiés ;
- état Docker PostgreSQL + CPU / mémoire / I/O ;
- taille de la base PostgreSQL ;
- lecture de la dernière migration `flyway_schema_history` ;
- CPU / RAM des processus backend/frontend ;
- tests backend et frontend depuis le launcher avec dernier résultat ;
- tâches développeur `clean` et `flyway:migrate` ;
- zone DB protégée avec reset destructif désactivé par défaut ;
- détection des erreurs de compilation Angular dans les logs ;
- notifications Windows sur crash / erreur de build ;
- boutons App, Backend, Swagger et pgAdmin ;
- profils DEV / TEST / DEMO ;
- sessions développeur historisées ;
- démarrage automatique avec Windows en option ;
- mise à jour automatique du launcher ;
- restauration automatique des services gérés après installation d'une update ;
- icône native Windows pour la fenêtre, la barre des tâches, l'EXE et le tray.

## Installation dans MEN Pilot

Placez le dossier ici :

```text
D:\Workspaces\men-pilot\launcher
```

Arborescence :

```text
men-pilot\
├─ backend\
├─ frontend\
├─ docker-compose.yml
└─ launcher\
```

Première installation des dépendances :

```bat
launcher\scripts\install.cmd
```

Démarrage en mode source :

```bat
launcher\scripts\start.cmd
```

> Le mode `npm start` sert au développement du launcher. L'auto-update ne s'installe réellement que dans la version packagée Windows.

## Construire l'installateur Windows

```bat
launcher\scripts\build-exe.cmd
```

ou :

```bat
cd /d D:\Workspaces\men-pilot\launcher
npm run dist
```

Le résultat se trouve dans `launcher\dist`.

## Mise à jour automatique : principe

À partir de la V2, il n'est plus nécessaire de désinstaller / réinstaller manuellement le launcher pour chaque version.

Le launcher utilise `electron-updater` avec l'installateur NSIS. Il peut :

1. vérifier la présence d'une nouvelle version ;
2. télécharger la nouvelle version ;
3. afficher la progression ;
4. installer la nouvelle version ;
5. redémarrer le launcher ;
6. relancer automatiquement les services MEN Pilot que l'ancien launcher gérait avant l'update.

Deux modes de distribution sont intégrés.

### Mode recommandé : GitHub Releases

Le plus simple est d'avoir le code de MEN Pilot dans GitHub et d'utiliser le workflow fourni.

Une seule fois :

```bat
launcher\scripts\install-update-pipeline.cmd
```

Le script copie :

```text
launcher\templates\men-pilot-launcher-release.yml
```

vers :

```text
.github\workflows\men-pilot-launcher-release.yml
```

Committez et poussez le workflow.

Ensuite, pour publier une nouvelle version :

1. allez dans l'onglet **Actions** du dépôt GitHub ;
2. ouvrez **Release MEN Pilot Launcher** ;
3. cliquez sur **Run workflow** ;
4. saisissez par exemple `2.0.1` ;
5. GitHub construit automatiquement l'EXE et publie la Release.

Les launchers déjà installés récupèrent ensuite automatiquement cette Release.

### Important pour un dépôt GitHub privé

L'updater GitHub privé nécessite une authentification côté machine cliente. Le montage recommandé pour MEN Pilot est donc de garder le code privé et d'utiliser, si nécessaire, un **petit dépôt public uniquement destiné aux binaires du launcher**. Il ne contient aucun code source.

Le workflow fourni supporte ce montage :

- variable GitHub Actions `MEN_LAUNCHER_RELEASE_REPOSITORY` = `owner/men-pilot-launcher-releases` ;
- secret `MEN_LAUNCHER_RELEASE_TOKEN` = token ayant uniquement le droit d'écrire les Releases de ce dépôt.

Si ces deux éléments ne sont pas renseignés, le workflow publie par défaut dans le dépôt courant avec `GITHUB_TOKEN`.

Alternative : utiliser le mode serveur générique ci-dessous.

### Mode serveur générique

Le launcher accepte également une URL HTTP(S) statique dans :

```text
Configuration > URL serveur de mises à jour générique
```

Exemple de structure du serveur :

```text
https://updates.example.fr/men-pilot-launcher/
├─ latest.yml
├─ MEN-Pilot-Launcher-2.0.1-x64.exe
└─ MEN-Pilot-Launcher-2.0.1-x64.exe.blockmap
```

Pour générer ces fichiers :

```bat
launcher\scripts\build-update.cmd
```

Puis publiez le contenu correspondant de `dist\` sur ce répertoire HTTP(S).

## Pourquoi une dernière installation V2 est nécessaire

Une V1 qui ne contenait pas encore l'updater ne peut pas s'auto-transformer en V2.

Il faut donc installer **une fois** la V2 packagée. Ensuite les versions V2.0.1, V2.1, V3, etc. peuvent être distribuées directement depuis le launcher.

## Icône Windows

La V2 définit explicitement :

- `BrowserWindow.icon` ;
- l'icône de l'exécutable construite par electron-builder ;
- l'icône du tray ;
- un `AppUserModelId` Windows stable.

L'icône utilisée est :

```text
assets\men-pilot.ico
```

Si Windows conserve l'ancienne icône d'un raccourci déjà épinglé, désépinglez l'ancien raccourci une fois puis épinglez le nouvel EXE installé. Le nouvel installateur utilise ensuite la bonne icône.

## Profils DEV / TEST / DEMO

Les profils sont déclarés dans `config.json`. Par défaut ils n'injectent aucune variable supplémentaire afin de ne pas supposer que MEN Pilot possède déjà des profils Spring `test` ou `demo`.

Ils peuvent recevoir des variables d'environnement, par exemple :

```json
"profiles": {
  "dev": {
    "label": "DEV",
    "env": {
      "SPRING_PROFILES_ACTIVE": "dev"
    }
  }
}
```

Le launcher refuse de changer de profil pendant qu'un service MEN Pilot est en cours d'exécution.

## Zone protégée DB

Le reset de base est volontairement désactivé à l'installation.

Pour l'autoriser :

```text
Configuration > Autoriser le reset destructif de la DB locale
```

Puis le launcher exige encore la saisie exacte de :

```text
RESET
```

avant d'exécuter la commande configurée.

## Configuration persistante et mises à niveau

Les paramètres personnels sont stockés dans le dossier `userData` Electron de Windows, et non dans le dossier d'installation.

La V2 effectue une fusion récursive entre les nouveaux paramètres par défaut et les réglages existants. Ainsi, lorsqu'une nouvelle version ajoute une option, elle est créée sans écraser votre workspace, vos ports, vos URL ou vos préférences existantes.

Les données persistantes comprennent notamment :

- `config.json` ;
- `history.json` ;
- `developer-sessions.json` ;
- `runtime.json` ;
- `logs\...`.

## Commandes par défaut

```bat
# PostgreSQL
cd /d D:\Workspaces\men-pilot
docker compose up -d postgres

# Backend
cd /d D:\Workspaces\men-pilot\backend
.\mvnw.cmd spring-boot:run

# Frontend
cd /d D:\Workspaces\men-pilot\frontend
npm start
```

Tests :

```bat
# backend
.\mvnw.cmd test

# frontend
npm test -- --watch=false
```

Maintenance :

```bat
.\mvnw.cmd clean
.\mvnw.cmd flyway:migrate
```

Le `flyway:migrate` Maven dépend naturellement de la manière dont Flyway est configuré dans MEN Pilot. L'état du dashboard, lui, est lu directement depuis `flyway_schema_history` lorsqu'elle existe.
