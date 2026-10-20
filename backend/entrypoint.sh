#!/bin/sh
#
# Bring the schema up to date, then hand off to the real command.
#
# This is the only thing that creates tables. The app used to call
# Base.metadata.create_all on startup, which meant the migration chain was
# never run and drifted out of usability without anyone noticing.
#
set -e

# Only migrate when this container is starting the API server. One-off commands
# — `docker compose run backend alembic downgrade -1`, `... pytest`, a shell —
# must not silently re-run migrations first, or they cannot be used to inspect
# or test a database in a deliberately un-migrated state.
case "$1" in
  uvicorn)
    echo "entrypoint: applying database migrations..."
    alembic upgrade head
    echo "entrypoint: schema at $(alembic current 2>/dev/null | tail -n 1)"
    ;;
esac

# exec so the server replaces this shell as PID 1 and receives signals
# directly; without it, SIGTERM stops at the shell and shutdown degrades to a
# 10-second kill.
exec "$@"
