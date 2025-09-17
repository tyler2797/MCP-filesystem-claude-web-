# 🚀 MCP Claude Web Server

Serveur MCP (Model Context Protocol) compatible avec Claude Web via HTTPS/Cloudflare.

## ✅ Configuration Testée et Fonctionnelle

Cette configuration a été **testée avec succès** avec Claude Web et fournit **9 outils filesystem** fonctionnels :
- Connection MCP validée ✅
- Injection automatique des outils ✅ 
- Workspace sécurisé ✅
- URL publique HTTPS ✅

## 📁 Structure du dossier

```
mcp-claude-web-server/
├── mcp-http-wrapper.js    # Wrapper HTTP Express qui gère les requêtes MCP
├── package.json           # Dépendances Node.js
├── start-server.sh        # Script de démarrage automatique
├── README.md              # Cette documentation
├── mcp_wrapper.log        # Logs du wrapper (créé au démarrage)
├── cloudflared.log        # Logs du tunnel (créé au démarrage)
└── current_url.txt        # URL publique actuelle (créé au démarrage)
```

## 🔧 Installation

1. **Installer les dépendances** :
```bash
cd /home/tyler/mcp-claude-web-server
npm install
```

2. **Installer Cloudflare Tunnel** (si pas déjà fait) :
```bash
# Debian/Ubuntu
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb
```

## 🚀 Démarrage rapide

### Option 1 : Script automatique (RECOMMANDÉ)
```bash
cd /home/tyler/mcp-claude-web-server
./start-server.sh
```

Le script :
- ✅ Démarre le wrapper HTTP sur port 3020
- ✅ Lance le tunnel Cloudflare HTTPS
- ✅ Affiche l'URL publique pour Claude Web
- ✅ Garde les logs visibles
- ✅ Se nettoie proprement avec Ctrl+C

### Option 2 : Démarrage manuel
```bash
# Terminal 1 : Wrapper HTTP
node mcp-http-wrapper.js

# Terminal 2 : Tunnel Cloudflare
cloudflared tunnel --url http://localhost:3020
```

## 🌐 Configuration Claude Web

1. **Obtenir l'URL publique** :
   - Affichée par `start-server.sh`
   - Ou dans `current_url.txt`
   - Format : `https://[random].trycloudflare.com/mcp`

2. **Dans Claude Web** :
   - Aller dans **Settings → Connectors**
   - Cliquer **"Add New Connector"**
   - **URL** : Coller l'URL publique
   - **Name** : `Tyler MCP Filesystem`
   - Cliquer **"Connect"**

## 📊 Architecture

```
Claude Web (HTTPS)
    ↓
Cloudflare Tunnel (Public URL)
    ↓
HTTP Wrapper (Port 3020)
    ↓
MCP Filesystem Server (STDIO)
    ↓
Workspace (/home/tyler/claude-workspace)
```

## 🛠️ Fonctionnalités

### Enrichissement automatique
Le wrapper enrichit automatiquement la réponse `initialize` avec les 9 outils filesystem disponibles, résolvant le problème de Claude Web qui attend les outils dès l'initialisation.

### Outils disponibles (9) - TESTÉS ✅
- **read_file** : Lecture complète d'un fichier
- **read_multiple_files** : Lecture de plusieurs fichiers simultanément
- **write_file** : Création/écrasement de fichiers
- **create_directory** : Création de répertoires
- **list_directory** : Liste détaillée des fichiers/dossiers
- **move_file** : Déplacement/renommage de fichiers
- **search_files** : Recherche de fichiers par pattern
- **get_file_info** : Métadonnées détaillées des fichiers
- **list_allowed_directories** : Liste des répertoires autorisés

### Workspace sécurisé
- **Chemin** : `/home/tyler/claude-workspace/`
- **Isolation** : Accès limité à ce dossier uniquement
- **Sessions** : Chaque connexion = instance MCP isolée

## 📝 Logs et débogage

### Voir les logs en temps réel
```bash
# Logs du wrapper HTTP
tail -f mcp_wrapper.log

# Logs du tunnel Cloudflare
tail -f cloudflared.log

# Les deux en même temps
tail -f mcp_wrapper.log cloudflared.log
```

### Vérifier le statut
```bash
# Health check local
curl http://localhost:3020/health

# Test via URL publique
curl https://[votre-url].trycloudflare.com/health
```

## 🔄 Redémarrage

### Arrêter proprement
```bash
# Si lancé avec start-server.sh
Ctrl+C

# Sinon, manuellement
pkill -f "node.*mcp-http-wrapper"
pkill -f cloudflared
```

### Redémarrer
```bash
./start-server.sh
```

## ⚠️ Notes importantes

1. **URL dynamique** : Cloudflare génère une nouvelle URL à chaque démarrage
2. **Reconfiguration** : Mettre à jour l'URL dans Claude Web après redémarrage
3. **Sécurité** : Le tunnel est public, mais limité au workspace défini
4. **Persistance** : Les fichiers du workspace sont conservés entre les sessions

## 🐛 Dépannage

### Le wrapper ne démarre pas
```bash
# Vérifier le port 3020
netstat -tlnp | grep 3020

# Tuer les anciens processus
pkill -f "node.*mcp"
```

### Pas d'URL Cloudflare
```bash
# Vérifier les logs
tail -20 cloudflared.log

# Redémarrer manuellement
cloudflared tunnel --url http://localhost:3020
```

### Claude Web ne voit pas les outils
- Supprimer et recréer le connecteur
- Vérifier que l'URL se termine par `/mcp`
- Rafraîchir la page Claude Web

## 🎯 Test de Validation

La configuration a été testée avec succès :
```
📨 Claude Web → Tunnel HTTPS → Wrapper HTTP → MCP Server
✅ Initialize: OK
✅ Tools injection: 9 outils
✅ Session management: OK
✅ Filesystem access: OK
```

## 📚 Références

- [Model Context Protocol](https://github.com/anthropics/model-context-protocol)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps)
- [Claude Web](https://claude.ai)

---

**Version** : 1.0.0  
**Status** : ✅ Production Ready  
**Auteur** : Tyler  
**Licence** : MIT