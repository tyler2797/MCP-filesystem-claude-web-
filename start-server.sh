#!/bin/bash

# MCP Claude Web Server Launcher
# ================================
# Ce script démarre le serveur MCP avec tunnel HTTPS Cloudflare

echo "🚀 MCP Claude Web Server Launcher"
echo "================================="

# Configuration
PORT=3020
WORKSPACE="/home/tyler/claude-workspace"

# Vérifier si le workspace existe
if [ ! -d "$WORKSPACE" ]; then
    echo "📁 Création du workspace..."
    mkdir -p "$WORKSPACE"
    echo "# MCP Claude Workspace" > "$WORKSPACE/README.md"
fi

# Arrêter les anciens processus
echo "🔄 Arrêt des anciens processus..."
pkill -f "node.*mcp-http-wrapper" 2>/dev/null
pkill -f cloudflared 2>/dev/null
sleep 2

# Installer les dépendances si nécessaire
if [ ! -d "node_modules" ]; then
    echo "📦 Installation des dépendances..."
    npm install
fi

# Démarrer le wrapper HTTP
echo "🔧 Démarrage du wrapper HTTP sur port $PORT..."
node mcp-http-wrapper.js > mcp_wrapper.log 2>&1 &
WRAPPER_PID=$!
echo "   PID: $WRAPPER_PID"

sleep 2

# Vérifier que le wrapper est démarré
if curl -s "http://localhost:$PORT/health" > /dev/null; then
    echo "✅ Wrapper HTTP actif"
else
    echo "❌ Erreur: Le wrapper HTTP n'a pas démarré"
    exit 1
fi

# Démarrer le tunnel Cloudflare
echo "🌐 Démarrage du tunnel Cloudflare..."
cloudflared tunnel --url "http://localhost:$PORT" > cloudflared.log 2>&1 &
TUNNEL_PID=$!
echo "   PID: $TUNNEL_PID"

# Attendre que le tunnel soit prêt
echo "⏳ Attente de l'URL publique..."
sleep 5

# Extraire et afficher l'URL
URL=$(grep -o 'https://.*\.trycloudflare\.com' cloudflared.log | tail -1)

if [ -n "$URL" ]; then
    echo ""
    echo "✅ SERVEUR MCP OPÉRATIONNEL!"
    echo "================================="
    echo "📊 URL Claude Web: ${URL}/mcp"
    echo "🏠 URL Locale: http://localhost:$PORT/mcp"
    echo "📁 Workspace: $WORKSPACE"
    echo ""
    echo "🔧 Configuration Claude Web:"
    echo "   1. Settings → Connectors"
    echo "   2. Ajouter nouveau connecteur"
    echo "   3. URL: ${URL}/mcp"
    echo "   4. Nom: Tyler MCP Filesystem"
    echo ""
    echo "📝 Logs:"
    echo "   - Wrapper: tail -f mcp_wrapper.log"
    echo "   - Cloudflare: tail -f cloudflared.log"
    echo ""
    echo "🛑 Pour arrêter: kill $WRAPPER_PID $TUNNEL_PID"
    echo ""

    # Sauvegarder l'URL
    echo "${URL}/mcp" > current_url.txt

    # Garder le script actif
    echo "💡 Appuyez sur Ctrl+C pour arrêter le serveur"

    # Attendre et nettoyer à la sortie
    trap "echo '🛑 Arrêt...'; kill $WRAPPER_PID $TUNNEL_PID 2>/dev/null; exit" INT TERM
    wait
else
    echo "❌ Erreur: Impossible d'obtenir l'URL Cloudflare"
    kill $WRAPPER_PID 2>/dev/null
    exit 1
fi