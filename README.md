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
offers **"Ergebnisliste per Foto einlesen"** (the Endlauf admin has its own,
list-based variant — see below): take a
photo of the posted result sheet of that class, the server sends it to an OpenAI
vision model (`OPENAI_VISION_MODEL`, default `gpt-5.6`) with a strict JSON schema
and maps the columns onto Training / Lauf 1 / Lauf 2 with time + Strafsekunden.
Rows are fuzzy-matched (name + Verein, one-to-one) against the entries of the
class; confident matches are green, unsure ones are flagged, unmatched rows are
excluded until a driver is picked from the searchable list. Times can be edited in
the review table before **"Zeiten übernehmen"** bulk-saves them
(`POST /api/admin/events/[id]/import-runs`).
Photos are downscaled to 2048 px in the browser; empty cells are never written.

### Corrections and deleting times

Finalized classes are locked. To apply a judge's correction: **"Wieder öffnen
(Korrektur)"** on the class (`DELETE …/finalize-age-class`), edit the times (or
re-read the sheet from a photo), then **"Aus Zeiten finalisieren"** again —
positions and points are recomputed from the corrected times. While a class is
open, the trash icon on a row deletes all runs of that driver
(`DELETE /api/admin/entries/[id]/runs`) and **"Alle Zeiten löschen"** wipes the
whole class (`DELETE /api/admin/events/[id]/runs`).

## Endläufe 2026 (hmj + ADAC Hessen-Thüringen)

Separate data set under `/endlauf26/{hmj,adac-hth}`, seeded by `make seed-endlauf26`
(`webapp/scripts/seed-endlauf26.ts`, idempotent) from `data/endlauf26/`:

- **hmj** — `hmj.json`, generated from the official standings PDF
  (`make parse-endlauf26`). The seed imports *every* driver of the list; only
  the qualified ones (green in the PDF) form the Endlauf field and get entries,
  the rest is kept as the pool of replacement candidates.
- **ADAC Hessen-Thüringen** — `adac-hth_endlauf2026.csv`, the **final start
  list** and single source of truth for the field. Semicolon-separated, no
  header: `Klasse;Startplatz Endlauf 1;Nachname Vorname;Platz Regionalmeisterschaft;Verein;Region;[Nachrücker]`.
  The regional position is scored like one race via the points table (several
  drivers may carry the same position), column 7 = `Nachrücker` flags a
  replacement driver (badge *Nachrücker*, scored like everybody else), column 2
  becomes the live start order of all three Endläufe (for classes without live
  times). Club spellings are normalised to the names already in the database
  (`CLUB_ALIASES` in `lib/endlauf26/adac-field.ts`) so one club stays one team.
  Drivers of earlier imports that are not on the list are **deleted** by the
  seed (unless an official result exists for them — then they are kept and
  reported), as are clubs without drivers; there is no replacement pool for
  ADAC. `adac-hth.json` (regional standings PDFs) only enriches matching
  drivers with Ausweis-Nr., season totals and per-race results.

Field changes are managed on `/endlauf26/[champ]/admin` → **Fahrerfeld** and apply
to all Endläufe of the championship (announce them before the first Endlauf):

- **Abmelden** — the driver will not compete. He disappears from start lists and
  the live board and is excluded from the ranking in both championships: he stays
  in the championship table (badge *abgemeldet*, season points still visible) but
  unranked at the bottom of his class. Reversible.
- **Nachnominieren** — pick a non-qualified driver of the same class from the
  list; he is entered in every Endlauf, starts first in classes that have not
  begun yet (worst pre-Endlauf standing starts first) and scores like a
  qualified driver (badge *Nachrücker*). Reversible while no result is stored.
  Usually not needed by hand: a driver who appears on an imported result list
  without being green in the PDF becomes a Nachrücker automatically.

A driver who is listed but does not appear on the result list needs no action:
he gets no position and 0 points for that Endlauf (ADAC: *n. g.* in the table).

### Official results: photo of the result list → championship

The **only** source of Endlauf positions and points is the printed official
result list of each age class. On `/endlauf26/[champ]/admin/events/[slug]` →
**Offizielle Ergebnislisten**, every class has **"Liste einlesen"**: photograph
the posted list (one class per photo; a two-page class is read as two photos —
rows of other drivers are kept), the server reads the full hmj column set
(Platz, Startplatz, Name, ADAC Ortsclub, Ausweis-Nr., Wertung D/M, Training,
1./2. Lauf Zeit + Fehler, Gesamt Fehler, Gesamtzeit, ADAC Punkte — without the
×1,25 factor) and proposes a driver from the whole class pool (field *and*
replacement candidates; exact Ausweis-Nr. wins, then name + club). Every value
is editable in the review table; plausibility checks run on every edit and only
**flag** what does not add up (Gesamtzeit ≠ sum of runs + penalties, Gesamt
Fehler ≠ sum, points ≠ points table for the place, a shorter Gesamtzeit placed
behind a longer one, duplicate/missing places, unknown Ortsclub — acknowledge it
or **"Verein anlegen"**). The printed order is never changed.
**"Ergebnisse übernehmen"** stores the rows and the photo
(`POST /api/endlauf26/events/[id]/results/ocr` → `…/results/import`), fills in
missing Ausweis-Nr. / Wertung on the driver, turns non-green drivers into
Nachrücker and re-activates withdrawn drivers who did start. No live state is
required at any point; the championship table follows immediately.

Corrections: **"Liste erneut einlesen"** replaces the rows of the drivers on the
new photo, **"Liste löschen"** removes the class result (`DELETE …/results`),
stored photos can be opened and deleted individually
(`/api/endlauf26/result-images/[id]`). **"Endlauf zurücksetzen"** (bottom of
the event admin, confirm with the event slug — `POST …/reset`) deletes all
results, photos and live times of one Endlauf to start from scratch; field and
start orders stay.

Public event pages (`/endlauf26/[champ]/events/[slug]`) show the imported list
per class plus alternative "what if" scorings — **Nur schnellste Runde**
(fastest single run, no penalties), **Nur schnellste Runde (mit Fehlern)**
(best single run counted with its penalty seconds), **Ohne Fehler** (Lauf 1 + Lauf 2, no
penalties), **Nur Fehler** (by penalty seconds, tie → Gesamtzeit) — with a Diff
column to the leader or, after clicking a row, to that driver. Rows link to the
photo of the list.

### AI Prediction (driver page)

Below the results card on `/endlauf26/[champ]/driver/[id]` a short German
paragraph says what is still possible in the standings. The numbers are not
guessed by the model: `lib/endlauf26/prediction.ts` simulates the remaining
Endläufe (driver wins everything; per rival the worst finish they can afford
and still stay ahead; "realistic" = no rival finishes more than 5 places below
their current rank; risk from behind) and OpenAI (`OPENAI_PREDICTION_MODEL`,
default `gpt-5.6`) only phrases those facts. The text is cached per driver in
`endlauf26_predictions` and regenerated when the standings change. Without an
API key a rule-based sentence is shown instead.

### National finals (DKM)

Positions that qualify for the *Deutsche Kartslalom Meisterschaft der dmsj*
carry a small German flag (`assignDkmSpots` in `lib/endlauf26/ranking.ts`,
`row.dkmVia`):

- **hmj**: Klasse 1: 1–2, Klasse 2–4: 1–3, Klasse 5: 1–2 (`HMJ_DKM_SPOTS`).
- **ADAC**: the Endläufe award the *last* spot per class 1–5
  (`ADAC_DKM_SPOTS`). It goes to the class winner — unless the winner is already
  qualified through the hmj standings (as computed from the hmj Endlauf
  results in the database), then to the runner-up, and so on. Drivers already
  qualified via hmj carry a grey *🇩🇪 hmj* badge next to their name and do not
  consume the ADAC spot; the driver who currently gets it has the flag on the
  rank. Matching between the two championships is by name (tolerant of
  spelling differences, `lib/endlauf26/names.ts`) and age class.
- Klasse 6 has no national final in either championship.

The teams page counts only spots awarded by the championship shown (ADAC:
hmj-qualified drivers are not counted).

### Vereine & Regionen (teams page)

`/endlauf26/[champ]/teams` groups the championship by club and by region
(hmj: Verband Süd / Nord / DMV, ADAC: Region Nord / Süd / Ost):

- points tables (total and Ø per driver) with class leaders, championship
  podiums, DKM spots, Endlauf wins/podiums, fastest laps and drivers per class;
  for hmj in two variants — official scoring with Streichresultat (default)
  and `?drops=off` with every race counted; hmj additionally gets
  **Endlauf-Punkte pro Fahrer (Ø) – nur Langgöns**: points from the two
  Endläufe alone, Ø per driver, once with every Endlauf result ("alle") and
  once with struck results excluded ("gezählt");
- places gained / lost in the championship through each Endlauf (sum of the
  per-driver movement arrows), in total and per driver;
- the fastest single run per Endlauf and class, once without and once with
  penalty seconds (`lib/endlauf26/team-stats.ts`);
- **Zitate für Social Media**: German one-liners about `HOME_TEAM` (OAMC
  Reinheim) and `HOME_REGION` (Süd) — how much more likely a driver of the club
  becomes Hessenmeister / stands on the podium / qualifies for the DKM compared
  to the rest of the field, share of fastest laps, places gained, clean runs …
  The numbers are computed deterministically (`buildSubjectFacts`), OpenAI
  (`OPENAI_PREDICTION_MODEL`) only phrases them; cached in `endlauf26_quotes`
  per (championship, subject) until the facts change, rule-based fallback
  without an API key. Clicking a quote copies it; admins get a **Neu** button
  to re-phrase (`GET /api/endlauf26/quotes/[champ]?subject=team|region&refresh=1`).

### Source documents

The lists the field was derived from are stored in the database (`make
seed-endlauf26` fills empty slots from `data/endlauf26/`: the hmj standings
PDF, the ADAC start-list CSV and the three regional standings PDFs; admins can
replace them under **Quelldokumente** on `/endlauf26/[champ]/admin`) and are
linked on the championship page (`/api/endlauf26/documents/[id]`). Replacing
the CSV document does *not* change the field — edit
`data/endlauf26/adac-hth_endlauf2026.csv` and re-run the seed for that.

### Live timing (tool only)

Setting an Endlauf **Live**, activating a class/driver and dictating or typing
times (collapsed **Live-Timing (Werkzeug)** section of the event admin,
`/endlauf26/[champ]/live` for spectators) is a convenience to follow selected
drivers during the event. The live board shows first name + initial, start
position, live position and the three times with penalties; live positions
rank by Lauf 1 + Lauf 2 incl. penalties. Live times never enter the
championship.

Deploying a schema change to an existing server database — the db targets run
*inside* the `webapp` container, so the image has to be rebuilt first
(`npm run db:push` first runs `scripts/pre-push.ts`, which drops objects removed
from the schema so `drizzle-kit push` needs no interactive rename prompt):

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
