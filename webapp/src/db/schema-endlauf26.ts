/**
 * Endläufe 2026 — a completely separate data set from the regular season.
 *
 * Two championships live here, keyed by `championship`:
 *  - `hmj`      Hessische Jugend-Landesmeisterschaft (hessische motorsport jugend)
 *  - `adac_hth` ADAC Hessen-Thüringen Endläufe
 *
 * They share drivers by name only; every row is scoped to its championship so
 * the two never mix (different rules, different events, different clubs).
 *
 * Two kinds of timing data exist side by side and never mix:
 *
 *  - `endlauf26_entries`  LIVE TIMING. Times typed/dictated at the track to
 *    follow selected drivers while a class is running. A convenience tool —
 *    never used for the championship.
 *  - `endlauf26_results`  OFFICIAL RESULTS. Read from the photographed result
 *    list of an age class (one row per driver). The printed position is the
 *    single source of truth; the championship table is computed from here.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/** Postgres `bytea` — node-postgres returns/accepts Buffers. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const endlauf26ChampionshipEnum = pgEnum("endlauf26_championship", [
  "hmj",
  "adac_hth",
]);

export const endlauf26EventStatusEnum = pgEnum("endlauf26_event_status", [
  "upcoming",
  "live",
  "completed",
]);

export const endlauf26Teams = pgTable(
  "endlauf26_teams",
  {
    id: serial("id").primaryKey(),
    championship: endlauf26ChampionshipEnum("championship").notNull(),
    name: text("name").notNull(),
  },
  (t) => [unique("endlauf26_teams_champ_name_unique").on(t.championship, t.name)],
);

export const endlauf26Drivers = pgTable(
  "endlauf26_drivers",
  {
    id: serial("id").primaryKey(),
    championship: endlauf26ChampionshipEnum("championship").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    teamId: integer("team_id")
      .notNull()
      .references(() => endlauf26Teams.id, { onDelete: "restrict" }),
    /** Age class 1–6 ("Klasse 1" … "Klasse 6"). */
    ageClass: integer("age_class").notNull(),
    /** HMJ only: umbrella organisation / Verband column of the source list (Süd, Nord, DMV, …). */
    verband: text("verband"),
    /** ADAC only: regional series the driver qualified through (Nord, Süd, Ost). */
    region: text("region"),
    /** ADAC membership ID ("Ausweis-Nr."). Unique per driver — used to match result lists. */
    adacId: text("adac_id"),
    /** "Wertung" column of the result lists: D (Damen) or M (Herren). Filled from imported results. */
    wertung: text("wertung"),
    /** Four-digit birth year — used as final tie-breaker (younger wins). Maintained manually. */
    yearOfBirth: integer("year_of_birth"),
    /** Position in the imported standings list (regional list for ADAC, HMJ list for HMJ). */
    seasonPosition: integer("season_position"),
    /** Total points in the imported standings list. */
    seasonPoints: numeric("season_points", { precision: 7, scale: 2 }),
    /** Number of regular-season races started. */
    seasonRaces: integer("season_races").notNull().default(0),
    /**
     * Qualified for the Endläufe according to the official standings list
     * (green row in the PDF). Non-qualified drivers are imported too — they
     * form the pool of Nachrücker and are otherwise invisible until they
     * are nominated or show up on a result list.
     */
    qualified: boolean("qualified").notNull().default(true),
    /** Announced before the Endläufe: the driver will not compete at all. Stays in the championship table (flagged), disappears from start lists. */
    withdrawn: boolean("withdrawn").notNull().default(false),
    /**
     * Nachrücker: non-qualified driver who fills a vacated spot — nominated by
     * hand or automatically because they appeared on an official result list.
     * Counts like a qualified driver.
     */
    nominated: boolean("nominated").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("endlauf26_drivers_champ_class_idx").on(t.championship, t.ageClass),
    unique("endlauf26_drivers_identity_unique").on(
      t.championship,
      t.firstName,
      t.lastName,
      t.teamId,
    ),
  ],
);

/**
 * HMJ only: the five regular-season results per driver (1. Lauf … 5. Lauf).
 * They feed the "best 6 of 7" calculation together with the two Endläufe.
 */
export const endlauf26SeasonResults = pgTable(
  "endlauf26_season_results",
  {
    id: serial("id").primaryKey(),
    driverId: integer("driver_id")
      .notNull()
      .references(() => endlauf26Drivers.id, { onDelete: "cascade" }),
    raceNumber: integer("race_number").notNull(),
    finishPosition: integer("finish_position").notNull(),
    points: integer("points").notNull(),
    /** Whether the source PDF marked this result as Streichergebnis (informational). */
    struckInSource: boolean("struck_in_source").notNull().default(false),
  },
  (t) => [
    unique("endlauf26_season_results_unique").on(t.driverId, t.raceNumber),
  ],
);

export const endlauf26Events = pgTable(
  "endlauf26_events",
  {
    id: serial("id").primaryKey(),
    championship: endlauf26ChampionshipEnum("championship").notNull(),
    /** 1-based order within the championship (Endlauf 1, 2, 3). */
    number: integer("number").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    eventDate: date("event_date"),
    /** Points multiplier for this event (1.25 for Langgöns, 1.1 for Malsfeld). */
    factor: numeric("factor", { precision: 4, scale: 2 }).notNull().default("1.00"),
    /** Live-timing state only (upcoming / live / completed). Has no effect on official results. */
    status: endlauf26EventStatusEnum("status").notNull().default("upcoming"),
    /** Live timing: age class currently running (1–6). At most one per event. */
    liveAgeClass: integer("live_age_class"),
    /** Live timing: entry currently on track — only this entry accepts time input. No FK to avoid a cycle. */
    liveEntryId: integer("live_entry_id"),
  },
  (t) => [
    unique("endlauf26_events_champ_number_unique").on(t.championship, t.number),
    unique("endlauf26_events_champ_slug_unique").on(t.championship, t.slug),
  ],
);

/**
 * LIVE TIMING entries — one per (event, driver of the field). Start list +
 * hand-recorded times. Purely a tool for following the running class; the
 * official result comes from `endlauf26_results`.
 */
export const endlauf26Entries = pgTable(
  "endlauf26_entries",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => endlauf26Events.id, { onDelete: "cascade" }),
    driverId: integer("driver_id")
      .notNull()
      .references(() => endlauf26Drivers.id, { onDelete: "cascade" }),
    ageClass: integer("age_class").notNull(),
    startingOrder: integer("starting_order"),

    testTime: numeric("test_time", { precision: 8, scale: 3 }),
    testPenalty: integer("test_penalty").notNull().default(0),
    run1Time: numeric("run1_time", { precision: 8, scale: 3 }),
    run1Penalty: integer("run1_penalty").notNull().default(0),
    run2Time: numeric("run2_time", { precision: 8, scale: 3 }),
    run2Penalty: integer("run2_penalty").notNull().default(0),

    /** Live standing after Wertungslauf 1 (recomputed on every save). */
    positionRun1: integer("position_run1"),
    /** Live standing in Wertungslauf 2 alone. */
    positionRun2: integer("position_run2"),
    /** Live overall standing (Lauf 1 + Lauf 2 incl. penalties; fewer completed runs rank behind). */
    positionLive: integer("position_live"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("endlauf26_entries_event_idx").on(t.eventId),
    index("endlauf26_entries_driver_idx").on(t.driverId),
    unique("endlauf26_entries_event_driver_unique").on(t.eventId, t.driverId),
  ],
);

/**
 * Photographs of the official result lists (one age class per photo, a class
 * may span two photos). Stored so the source of every imported result can be
 * opened later.
 */
export const endlauf26ResultImages = pgTable(
  "endlauf26_result_images",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => endlauf26Events.id, { onDelete: "cascade" }),
    ageClass: integer("age_class").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  },
  (t) => [index("endlauf26_result_images_event_class_idx").on(t.eventId, t.ageClass)],
);

/**
 * OFFICIAL RESULTS — one row per (event, driver), read from the result list.
 * `position` is the single source of truth for the championship; the times
 * are stored for display, alternative scorings and plausibility checks.
 */
export const endlauf26Results = pgTable(
  "endlauf26_results",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => endlauf26Events.id, { onDelete: "cascade" }),
    driverId: integer("driver_id")
      .notNull()
      .references(() => endlauf26Drivers.id, { onDelete: "cascade" }),
    ageClass: integer("age_class").notNull(),
    /** Official finishing position as printed. Never derived. */
    position: integer("position"),
    /** Starting position as printed. */
    startPosition: integer("start_position"),
    /** D (Damen) / M (Herren) as printed. */
    wertung: text("wertung"),
    testTime: numeric("test_time", { precision: 8, scale: 3 }),
    run1Time: numeric("run1_time", { precision: 8, scale: 3 }),
    run1Penalty: integer("run1_penalty").notNull().default(0),
    run2Time: numeric("run2_time", { precision: 8, scale: 3 }),
    run2Penalty: integer("run2_penalty").notNull().default(0),
    /** "Gesamt Fehler" as printed (should equal run1 + run2 penalties). */
    totalPenalty: integer("total_penalty"),
    /** "Gesamtzeit" as printed (should equal both runs incl. penalties). */
    totalTime: numeric("total_time", { precision: 8, scale: 3 }),
    /** "ADAC Punkte" as printed — base points WITHOUT the event factor. */
    points: integer("points"),
    /** Ortsclub / Ausweis-Nr. exactly as printed (for auditing the match). */
    sheetTeam: text("sheet_team"),
    sheetAdacId: text("sheet_adac_id"),
    /** Plausibility warnings that were still open when the row was imported. */
    warnings: jsonb("warnings").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Photo this row was read from. */
    imageId: integer("image_id").references(() => endlauf26ResultImages.id, {
      onDelete: "set null",
    }),
    importedAt: timestamp("imported_at").defaultNow().notNull(),
  },
  (t) => [
    index("endlauf26_results_event_class_idx").on(t.eventId, t.ageClass),
    unique("endlauf26_results_event_driver_unique").on(t.eventId, t.driverId),
  ],
);

/**
 * Source documents: the official standings PDFs all driver data was derived
 * from (hmj: one list; ADAC: one per region). Uploaded by admins, viewable by
 * everyone.
 */
export const endlauf26Documents = pgTable(
  "endlauf26_documents",
  {
    id: serial("id").primaryKey(),
    championship: endlauf26ChampionshipEnum("championship").notNull(),
    /** Stable slot: `hmj` | `nord` | `sued` | `ost`. */
    key: text("key").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  },
  (t) => [unique("endlauf26_documents_champ_key_unique").on(t.championship, t.key)],
);

/* Relations */

export const endlauf26TeamsRelations = relations(endlauf26Teams, ({ many }) => ({
  drivers: many(endlauf26Drivers),
}));

export const endlauf26DriversRelations = relations(
  endlauf26Drivers,
  ({ one, many }) => ({
    team: one(endlauf26Teams, {
      fields: [endlauf26Drivers.teamId],
      references: [endlauf26Teams.id],
    }),
    seasonResults: many(endlauf26SeasonResults),
    entries: many(endlauf26Entries),
    results: many(endlauf26Results),
  }),
);

export const endlauf26SeasonResultsRelations = relations(
  endlauf26SeasonResults,
  ({ one }) => ({
    driver: one(endlauf26Drivers, {
      fields: [endlauf26SeasonResults.driverId],
      references: [endlauf26Drivers.id],
    }),
  }),
);

export const endlauf26EventsRelations = relations(
  endlauf26Events,
  ({ many }) => ({
    entries: many(endlauf26Entries),
    results: many(endlauf26Results),
    resultImages: many(endlauf26ResultImages),
  }),
);

export const endlauf26EntriesRelations = relations(
  endlauf26Entries,
  ({ one }) => ({
    event: one(endlauf26Events, {
      fields: [endlauf26Entries.eventId],
      references: [endlauf26Events.id],
    }),
    driver: one(endlauf26Drivers, {
      fields: [endlauf26Entries.driverId],
      references: [endlauf26Drivers.id],
    }),
  }),
);

export const endlauf26ResultsRelations = relations(endlauf26Results, ({ one }) => ({
  event: one(endlauf26Events, {
    fields: [endlauf26Results.eventId],
    references: [endlauf26Events.id],
  }),
  driver: one(endlauf26Drivers, {
    fields: [endlauf26Results.driverId],
    references: [endlauf26Drivers.id],
  }),
  image: one(endlauf26ResultImages, {
    fields: [endlauf26Results.imageId],
    references: [endlauf26ResultImages.id],
  }),
}));

export const endlauf26ResultImagesRelations = relations(
  endlauf26ResultImages,
  ({ one, many }) => ({
    event: one(endlauf26Events, {
      fields: [endlauf26ResultImages.eventId],
      references: [endlauf26Events.id],
    }),
    results: many(endlauf26Results),
  }),
);
