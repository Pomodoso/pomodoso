# Local development. `make help` lists the targets; `make dev` runs everything.
#
#   Postgres  localhost:5443   (docker-compose.yml)
#   API       localhost:8080   (backend/.env)
#   Web       localhost:5180   (web/.env.local → API :8080)
#   Extension extension/dist   (load unpacked in chrome://extensions)

# docker compose when Docker is installed, podman compose otherwise.
COMPOSE ?= $(shell command -v docker >/dev/null 2>&1 && echo "docker compose" || echo "podman compose")

WEB_URL := http://localhost:5180

.PHONY: help install up down logs db-reset backend web extension dev test seed-apps

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

install: ## Install the JS dependencies
	pnpm install

up: ## Start Postgres and wait until it accepts connections
	$(COMPOSE) up -d postgres
	@until $(COMPOSE) exec -T postgres pg_isready -U postgres -d pomodoso >/dev/null 2>&1; do sleep 1; done
	@echo "→ Postgres on localhost:5443"

down: ## Stop Postgres (the data volume stays)
	$(COMPOSE) down

logs: ## Follow Postgres' logs
	$(COMPOSE) logs -f postgres

db-reset: up ## Drop and recreate the local database (needs sqlx-cli)
	cd backend && sqlx database reset -y

backend: up ## API on :8080; runs pending migrations on start
	cd backend && cargo run

web: ## Web app on :5180
	pnpm --filter web dev

extension: ## Extension dev build into extension/dist, rebuilt on change; talks to :8080 and the local web
	cd extension && VITE_WEB_URL=$(WEB_URL) pnpm exec vite build --mode development --watch

dev: up ## Postgres, then API, web and extension together (Ctrl-C stops all three)
	@$(MAKE) --no-print-directory -j3 backend web extension

seed-apps: ## Publish Pomodoso's own apps as the Pomodoso account (POMODOSO_APPS_EMAIL/PASSWORD; API_URL, default :8080)
	cd shared/types && API_URL=$(or $(API_URL),http://localhost:8080) node --experimental-strip-types scripts/seed-apps.ts

test: ## JS tests and backend tests
	pnpm -r test
	cd backend && cargo test
