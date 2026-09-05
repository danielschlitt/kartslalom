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

### Result sheet OCR (photo → times)

While an event is **live**, every non-finalized age class on `/admin/events/[id]`
(and on the Endlauf admin) offers **"Ergebnisliste per Foto einlesen"**: take a
photo of the posted result sheet of that class, the server sends it to an OpenAI
vision model (`OPENAI_VISION_MODEL`, default `gpt-5.6`) with a strict JSON schema
and maps the columns onto Training / Lauf 1 / Lauf 2 with time + Strafsekunden.
Rows are fuzzy-matched (name + Verein, one-to-one) against the entries of the
class; confident matches are green, unsure ones are flagged, unmatched rows are
excluded until a driver is picked from the searchable list. Times can be edited in
the review table before **"Zeiten übernehmen"** bulk-saves them
(`POST /api/admin/events/[id]/import-runs`, Endlauf: `/api/endlauf26/events/[id]/import-runs`).
Photos are downscaled to 2048 px in the browser; empty cells are never written.

### Corrections and deleting times

Finalized classes are locked. To apply a judge's correction: **"Wieder öffnen
(Korrektur)"** on the class (`DELETE …/finalize-age-class`), edit the times (or
re-read the sheet from a photo), then **"Aus Zeiten finalisieren"** again —
positions and points are recomputed from the corrected times. While a class is
open, the trash icon on a row deletes all runs of that driver
(`DELETE /api/admin/entries/[id]/runs`) and **"Alle Zeiten löschen"** wipes the
whole class (`DELETE /api/admin/events/[id]/runs`). The Endlauf admin has the same
buttons (`DELETE /api/endlauf26/entries/[id]/runs`, `DELETE /api/endlauf26/events/[id]/runs`;
live event required, live positions are recomputed).

## Endläufe 2026 (hmj + ADAC Hessen-Thüringen)

Separate data set under `/endlauf26/{hmj,adac-hth}`, seeded from the official
standings PDFs (`make parse-endlauf26` → `data/endlauf26/*.json` → `make seed-endlauf26`).
The seed imports *every* driver of the lists; only the qualified ones (green in
the PDF) form the Endlauf field and get entries, the rest is kept as the pool of
replacement candidates.

Field changes are managed on `/endlauf26/[champ]/admin` → **Fahrerfeld** and apply
to all Endläufe of the championship (announce them before the first Endlauf):

- **Abmelden** — the driver will not compete. He disappears from start lists and
  the live board and is excluded from the ranking in both championships: he stays
  in the championship table (badge *abgemeldet*, season points still visible) but
  unranked at the bottom of his class. Reversible.
- **Nachnominieren** — pick a non-qualified driver of the same class from the
  list; he is entered in every Endlauf, starts first in classes that have not
  begun yet (worst pre-Endlauf standing starts first) and scores like a
  qualified driver (badge *nachnominiert*). Reversible while no time is stored.

A driver who is listed but simply does not set a time at an Endlauf needs no
action: leave his times empty, finalize the class — he gets no position and 0
points (ADAC: *n. g.* in the table).

Deploying a schema change (e.g. the `qualified` / `withdrawn` / `nominated`
columns) to an existing server database — the db targets run *inside* the
`webapp` container, so the image has to be rebuilt first:

```sh
make deploy                      # rsync + rebuild + restart the containers
make server-db-push              # apply the schema to the server DB
make server-db-seed-endlauf26    # import new drivers / replacement candidates
```

Chain them (`make deploy && make server-db-push && make server-db-seed-endlauf26`):
between the restart and the push, pages that read the new columns fail.

## Data sources

The seed script ([webapp/scripts/seed.ts](webapp/scripts/seed.ts)) reads the txt files in [data/](data/):

- `race-events.txt` — 8 events, German date format, HMJ flag and kart type in parens
- `race-teams.txt` — participating teams
- `race-drivers.txt` — drivers with class + finish positions for races 1–5 (only Altersklasse I–III used for now)
- `championship-points.txt` — points per finish position (1=40 .. 35=1)

Adjust those files and re-run `make seed-db` to refresh.
