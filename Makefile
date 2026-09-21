.PHONY: up down build logs test test-backend test-db test-frontend test-landing test-watch test-smoke test-migrations seed seed-admin migrate shell-backend shell-db

up:
	docker compose up

down:
	docker compose down

build:
	docker compose build

logs:
	docker compose logs -f

# Tests
test:
	$(MAKE) test-backend
	$(MAKE) test-frontend
	$(MAKE) test-landing

test-backend:
	docker compose exec backend pytest -v

# Create the test database the backend suite connects to (TEST_DATABASE_URL).
# db/init/ only runs on a fresh postgres_data volume, so existing volumes need
# this one-off. Idempotent — Postgres has no CREATE DATABASE IF NOT EXISTS.
test-db:
	@docker compose exec db psql -U postgres -tc \
		"SELECT 1 FROM pg_database WHERE datname='repopulse_test'" \
		| grep -q 1 \
		|| docker compose exec db psql -U postgres -c "CREATE DATABASE repopulse_test"
	@echo "repopulse_test ready"

test-smoke:
	docker compose exec backend pytest tests/test_smoke.py -v

# The same checks CI gates a merge on (.github/workflows/migrations.yml): the chain
# applies to an empty database, the result matches the models, one head only.
test-migrations:
	docker compose exec backend pytest tests/test_migrations.py -v

test-frontend:
	docker compose exec frontend npx vitest run

# The landing page and the product tour it frames are static documents in
# frontend/public/, so their tests need neither the stack nor a browser: they
# parse each file, run its script in jsdom and check structure, cascade and
# contrast. Everything layout-dependent is arithmetic, never a measurement.
test-landing:
	node --test tests/*.test.cjs

test-watch:
	docker compose exec frontend npx vitest

# Database
seed:
	docker compose exec backend python -m app.db.seed

# Bootstrap the first admin without wiping anything, for a real deployment.
# ADMIN_EMAIL is required; ADMIN_PASSWORD optional (omitted = setup link).
seed-admin:
	docker compose exec -e ADMIN_EMAIL -e ADMIN_NAME -e ADMIN_PASSWORD backend python -m app.db.seed_admin

migrate:
	docker compose exec backend alembic upgrade head

migration:
	docker compose exec backend alembic revision --autogenerate -m "$(MSG)"

# Shells
shell-backend:
	docker compose exec backend bash

shell-db:
	docker compose exec db psql -U postgres -d repopulse
