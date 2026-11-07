#!/bin/sh
# Démarré en root : on rend le volume /data à l'utilisateur `node`, puis on abandonne les privilèges.
set -e
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "${DATA_DIR:-/data}" 2>/dev/null || true
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
