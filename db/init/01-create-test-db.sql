-- Provision the database the backend test suite connects to.
--
-- backend/app/core/config.py sets TEST_DATABASE_URL to .../repopulse_test, and
-- tests/conftest.py creates the *tables* inside it — but the database itself
-- has to exist first, or every DB-backed test errors at fixture setup with
-- asyncpg InvalidCatalogNameError.
--
-- Postgres only runs the scripts in /docker-entrypoint-initdb.d/ when the data
-- directory is empty, i.e. on a brand-new volume. If you already have a
-- postgres_data volume, run `make test-db` instead.

CREATE DATABASE repopulse_test;
