# kartslalom.just-motorsport.de

Live timing and championship tracker for the **Hessen-Thüringen Süd** kart slalom championship (and the embedded **HMJ** sub-championship).

## Stack

- Next.js 16 (App Router, React 19, Tailwind v4)
- Postgres 17 + Drizzle ORM
- Docker Compose (local Postgres only; production stack uses Traefik labels)

## Quickstart

```bash
cp .env.sample .env
make install   # starts Postgres, installs deps, runs db:push, seeds data
make dev       # local dev: webapp on :3000, drizzle studio
```

Open http://localhost:3000 — the home redirects to the next upcoming or live event.

## Useful targets

| Target | Purpose |
|--------|---------|
| `make start-db` / `make stop-db` | Local Postgres |
| `make push-db` | `drizzle-kit push` (apply schema) |
| `make seed-db` | Re-run the seed script |
| `make reset-db` | Wipe and recreate the local database |
| `make build` / `make up` / `make down` | Production compose lifecycle |

## Admin (token gate)

Admin pages and all mutating API routes are gated by a single shared token:
`ADMIN_TOKEN` from the environment (production: `.env.server`; local: `webapp/.env`),
falling back to `qwerty123` when unset. Open **Admin** in the top nav, enter the
token once, and the browser keeps an HttpOnly cookie for a year. Admin links on
public pages (Endlauf "Admin" tab, "Zeiten erfassen", home quick links) are only
rendered for unlocked browsers. This is a light gate, not real authentication.

Timing entry and event management lives under `/admin`:

- `/admin/events/[id]` — set starting order, enter run times + penalty seconds, change event status
- `/admin/import` — CSV bulk import for backfilling past event timings

## Data sources

The seed script ([webapp/scripts/seed.ts](webapp/scripts/seed.ts)) reads the txt files in [data/](data/):

- `race-events.txt` — 8 events, German date format, HMJ flag and kart type in parens
- `race-teams.txt` — participating teams
- `race-drivers.txt` — drivers with class + finish positions for races 1–5 (only Altersklasse I–III used for now)
- `championship-points.txt` — points per finish position (1=40 .. 35=1)

Adjust those files and re-run `make seed-db` to refresh.
