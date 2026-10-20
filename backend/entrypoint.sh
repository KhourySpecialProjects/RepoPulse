#!/bin/sh
set -e

export INFISICAL_TOKEN=$(infisical login \
  --method=universal-auth \
  --client-id="$INFISICAL_CLIENT_ID" \
  --client-secret="$INFISICAL_CLIENT_SECRET" \
  --plain --silent)

case "$1" in
  uvicorn)
    echo "entrypoint: applying database migrations..."
    infisical run --projectId="$INFISICAL_PROJECT_ID" --env=prod -- alembic upgrade head
    echo "entrypoint: schema at $(infisical run --projectId="$INFISICAL_PROJECT_ID" --env=prod -- alembic current 2>/dev/null | tail -n 1)"
    ;;
esac

exec infisical run --projectId="$INFISICAL_PROJECT_ID" --env=prod -- "$@"
