.PHONY: up down build logs test test-backend test-frontend test-watch test-smoke seed migrate shell-backend shell-db

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

test-backend:
	docker compose exec backend pytest -v

test-smoke:
	docker compose exec backend pytest tests/test_smoke.py -v

test-frontend:
	docker compose exec frontend npx vitest run

test-watch:
	docker compose exec frontend npx vitest

# Database
seed:
	docker compose exec backend python -m app.db.seed

migrate:
	docker compose exec backend alembic upgrade head

migration:
	docker compose exec backend alembic revision --autogenerate -m "$(MSG)"

# Shells
shell-backend:
	docker compose exec backend bash

shell-db:
	docker compose exec db psql -U postgres -d repopulse
