#!/bin/sh
#
# Bring the schema up to date, then hand off to the real command.
#
# This is the only thing that creates tables. The app used to call
# Base.metadata.create_all on startup, which meant the migration chain was
# never run and drifted out of usability without anyone noticing.
#
# Secrets come from Infisical when it is configured, and from the container's
# own environment (.env) when it is not. The deployed server sets all three of
# INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET and INFISICAL_PROJECT_ID; a local
# checkout sets none. Requiring Infisical unconditionally made the backend exit
# at startup everywhere without those credentials, and every request the
# frontend made failed with it. tests/test_entrypoint.py covers both paths.
#
set -e

INFISICAL_ENV="${INFISICAL_ENV:-prod}"
use_infisical=""

if [ -n "$INFISICAL_CLIENT_ID$INFISICAL_CLIENT_SECRET$INFISICAL_PROJECT_ID" ]; then
  # Some set but not all is a misconfigured server, not a request to skip
  # Infisical: starting without its secrets would only fail later, less clearly.
  for var in INFISICAL_CLIENT_ID INFISICAL_CLIENT_SECRET INFISICAL_PROJECT_ID; do
    eval "value=\${$var:-}"
    if [ -z "$value" ]; then
      echo "entrypoint: $var is not set. Set all of INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET and INFISICAL_PROJECT_ID, or none of them." >&2
      exit 1
    fi
  done

  # A plain assignment, not `export VAR=$(...)`: export's own exit status hides
  # a failed login from set -e, and the server would start without its secrets.
  INFISICAL_TOKEN=$(infisical login \
    --method=universal-auth \
    --client-id="$INFISICAL_CLIENT_ID" \
    --client-secret="$INFISICAL_CLIENT_SECRET" \
    --plain --silent)
  export INFISICAL_TOKEN
  use_infisical=1
fi

# Run a command with Infisical's secrets injected, when Infisical is configured.
with_secrets() {
  if [ -n "$use_infisical" ]; then
    infisical run --projectId="$INFISICAL_PROJECT_ID" --env="$INFISICAL_ENV" -- "$@"
  else
    "$@"
  fi
}

# Only migrate when this container is starting the API server. One-off commands
# — `docker compose run backend alembic downgrade -1`, `... pytest`, a shell —
# must not silently re-run migrations first, or they cannot be used to inspect
# or test a database in a deliberately un-migrated state.
case "$1" in
  uvicorn)
    echo "entrypoint: applying database migrations..."
    with_secrets alembic upgrade head
    echo "entrypoint: schema at $(with_secrets alembic current 2>/dev/null | tail -n 1)"
    ;;
esac

# exec so the server replaces this shell as PID 1 and receives signals
# directly; without it, SIGTERM stops at the shell and shutdown degrades to a
# 10-second kill. (A shell function cannot be exec'd, hence no with_secrets.)
if [ -n "$use_infisical" ]; then
  exec infisical run --projectId="$INFISICAL_PROJECT_ID" --env="$INFISICAL_ENV" -- "$@"
fi
exec "$@"
