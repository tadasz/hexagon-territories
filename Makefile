# Nature Explorer developer entry points (specs/001-repo-foundations/tasks.md T017).
# Requires Docker Compose v2 and pnpm 10; API tasks run through the pnpm workspace.

COMPOSE      := docker compose -f infra/docker-compose.yml
DATABASE_URL ?= postgres://nature:nature@localhost:5432/nature
API          := pnpm --filter @nature/api

.PHONY: help dev test down logs db-migrate db-reset lint

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

dev: ## Start postgres + minio, migrate, run the API from source (tsx watch) on :3000
	$(COMPOSE) up -d --wait postgres minio
	$(COMPOSE) run --rm minio-init
	DATABASE_URL=$(DATABASE_URL) $(API) db:migrate
	DATABASE_URL=$(DATABASE_URL) $(API) dev

test: ## Start postgres and run every workspace's tests against it (DB integration tests included)
	$(COMPOSE) up -d --wait postgres
	DATABASE_URL=$(DATABASE_URL) pnpm test:db

down: ## Stop the stack and delete its volumes
	$(COMPOSE) down -v --remove-orphans

logs: ## Follow the stack's logs
	$(COMPOSE) logs -f --tail=100

db-migrate: ## Apply pending migrations to DATABASE_URL
	DATABASE_URL=$(DATABASE_URL) $(API) db:migrate

db-reset: ## Drop the postgres volume, start a fresh database and migrate
	$(COMPOSE) rm -sfv postgres
	-docker volume rm nature_postgres-data
	$(COMPOSE) up -d --wait postgres
	DATABASE_URL=$(DATABASE_URL) $(API) db:migrate

lint: ## Lint and typecheck every workspace
	pnpm lint
	pnpm typecheck
