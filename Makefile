POSTGRES_HOST ?= localhost
POSTGRES_PORT ?= 5432
POSTGRES_DB ?= kartslalom
POSTGRES_USER ?= postgres
POSTGRES_PASSWORD ?= password

ifneq (,$(wildcard .env))
include .env
else ifneq (,$(wildcard .env.sample))
include .env.sample
endif

ifneq (,$(wildcard .env.build))
include .env.build
endif

DATABASE_URL ?= postgresql://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@$(POSTGRES_HOST):$(POSTGRES_PORT)/$(POSTGRES_DB)

export POSTGRES_HOST POSTGRES_PORT POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL

.PHONY: create-server-dir check-deploy-vars provision deploy serverup server-db-push server-db-seed \
	server-db-fix-names start-db stop-db install dev dev-webapp dev-db seed-db push-db fix-names \
	reset-db build up down logs

# For a new installation copy needed files to the server
# NOTE: The scp/rsync command requires that the destination directory already exists on the remote server.
create-server-dir: check-deploy-vars
	ssh $(SERVER_USER)@$(SERVER_HOST) "\
		mkdir -p $(SERVER_PROJECT_PATH) && \
		chown $(SERVER_USER):docker $(SERVER_PROJECT_PATH) && \
		chmod 755 $(SERVER_PROJECT_PATH)"

check-deploy-vars:
	@test -n "$(SERVER_USER)" || (echo "Missing SERVER_USER in .env.build" && exit 1)
	@test -n "$(SERVER_HOST)" || (echo "Missing SERVER_HOST in .env.build" && exit 1)
	@test -n "$(SERVER_PROJECT_PATH)" || (echo "Missing SERVER_PROJECT_PATH in .env.build" && exit 1)
	@test -n "$(SERVER_DOCKER_COMPOSE)" || (echo "Missing SERVER_DOCKER_COMPOSE in .env.build" && exit 1)
	@test -n "$(SERVER_ENV_FILE)" || (echo "Missing SERVER_ENV_FILE in .env.build" && exit 1)
	@test -f "$(SERVER_ENV_FILE)" || (echo "Missing $(SERVER_ENV_FILE) — copy .env.server.sample and fill in production secrets" && exit 1)

provision: check-deploy-vars
	rsync -avz --delete \
		--exclude '.git/' \
		--exclude 'node_modules/' \
		--exclude 'webapp/node_modules/' \
		--exclude 'webapp/.next/' \
		--exclude '.env' \
		--exclude '.env.build' \
		--exclude '.env.sample' \
		--exclude '.env.server.sample' \
		--exclude '*.png' \
		--exclude 'plan.txt' \
		--exclude 'sample-docker-compose.yaml' \
		--exclude 'docker-compose.local.yaml' \
		--exclude 'Makefile' \
		--exclude 'README.md' \
		./ \
		$(SERVER_USER)@$(SERVER_HOST):$(SERVER_PROJECT_PATH)/

deploy: provision serverup

serverup: check-deploy-vars
	ssh $(SERVER_USER)@$(SERVER_HOST) "\
		cd $(SERVER_PROJECT_PATH) && \
		docker compose -f $(SERVER_DOCKER_COMPOSE) --env-file $(SERVER_ENV_FILE) down && \
		docker compose -f $(SERVER_DOCKER_COMPOSE) --env-file $(SERVER_ENV_FILE) up -d --build --remove-orphans"

server-db-push: check-deploy-vars
	ssh $(SERVER_USER)@$(SERVER_HOST) "\
		cd $(SERVER_PROJECT_PATH) && \
		docker compose -f $(SERVER_DOCKER_COMPOSE) --env-file $(SERVER_ENV_FILE) exec -T webapp npm run db:push"

server-db-seed: check-deploy-vars
	ssh $(SERVER_USER)@$(SERVER_HOST) "\
		cd $(SERVER_PROJECT_PATH) && \
		docker compose -f $(SERVER_DOCKER_COMPOSE) --env-file $(SERVER_ENV_FILE) exec -T webapp npm run db:seed"

# One-off repair for drivers with hyphenated names (e.g. Peruga-Kaminska, Jack-Leon).
# Derives affected rows from race-drivers.txt; idempotent — safe to re-run.
server-db-fix-names: check-deploy-vars
	ssh $(SERVER_USER)@$(SERVER_HOST) "\
		cd $(SERVER_PROJECT_PATH) && \
		docker compose -f $(SERVER_DOCKER_COMPOSE) --env-file $(SERVER_ENV_FILE) exec -T webapp npm run db:fix-names"

start-db:
	docker compose -f docker-compose.local.yaml up -d --wait

stop-db:
	docker compose -f docker-compose.local.yaml down

reset-db:
	docker compose -f docker-compose.local.yaml down -v
	$(MAKE) start-db
	cd webapp && npm run db:push
	$(MAKE) seed-db

install: start-db
	cd webapp && npm install
	cd webapp && npm run db:push
	$(MAKE) seed-db

push-db:
	cd webapp && npm run db:push

seed-db:
	cd webapp && npm run db:seed

fix-names:
	cd webapp && npm run db:fix-names

dev-webapp:
	cd webapp && npm run dev

dev-db:
	cd webapp && npm run db:studio

dev: start-db
	$(MAKE) -j2 dev-webapp dev-db

build:
	docker compose -f docker-compose.server.yaml build

up:
	docker compose -f docker-compose.server.yaml up -d --remove-orphans

down:
	docker compose -f docker-compose.server.yaml down

logs:
	docker compose -f docker-compose.server.yaml logs -f --tail=100
