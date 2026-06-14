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

DATABASE_URL ?= postgresql://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@$(POSTGRES_HOST):$(POSTGRES_PORT)/$(POSTGRES_DB)

export POSTGRES_HOST POSTGRES_PORT POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL

.PHONY: start-db stop-db install dev dev-webapp dev-db seed-db push-db reset-db build up down logs

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
