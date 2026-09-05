/**
 * Endläufe 2026 — a completely separate data set from the regular season.
 *
 * Two championships live here, keyed by `championship`:
 *  - `hmj`      Hessische Jugend-Landesmeisterschaft (hessische motorsport jugend)
 *  - `adac_hth` ADAC Hessen-Thüringen Endläufe
 *
 * They share drivers by name only; every row is scoped to its championship so
 * the two never mix (different rules, different events, different clubs).
 */
import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

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
    /** ADAC membership ID ("Ausweis"). */
    adacId: text("adac_id"),
    /** Four-digit birth year — used as final tie-breaker (younger wins). Maintained manually. */
    yearOfBirth: integer("year_of_birth"),
    /** Position in the imported standings list (regional list for ADAC, HMJ list for HMJ). */
    seasonPosition: integer("season_position"),
    /** Total points in the imported standings list. */
    seasonPoints: numeric("season_points", { precision: 7, scale: 2 }),
    /** Number of regular-season races started. */
    seasonRaces: integer("season_races").notNull().default(0),
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
    status: endlauf26EventStatusEnum("status").notNull().default("upcoming"),
    /** Age class currently running (1–6). At most one per event. */
    liveAgeClass: integer("live_age_class"),
    /** Entry currently on track — only this entry accepts time input. No FK to avoid a cycle. */
    liveEntryId: integer("live_entry_id"),
  },
  (t) => [
    unique("endlauf26_events_champ_number_unique").on(t.championship, t.number),
    unique("endlauf26_events_champ_slug_unique").on(t.championship, t.slug),
  ],
);

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
    /** Live standing after Wertungslauf 2. */
    positionRun2: integer("position_run2"),
    /** Live overall standing (best run + penalties). */
    positionLive: integer("position_live"),

    /** Official finishing position once the class is finalized. */
    finishPosition: integer("finish_position"),
    /** Base points from the points scale (factor is applied at calculation time). */
    pointsAwarded: integer("points_awarded").notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("endlauf26_entries_event_idx").on(t.eventId),
    index("endlauf26_entries_driver_idx").on(t.driverId),
    unique("endlauf26_entries_event_driver_unique").on(t.eventId, t.driverId),
  ],
);

export const endlauf26Finalizations = pgTable(
  "endlauf26_finalizations",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => endlauf26Events.id, { onDelete: "cascade" }),
    ageClass: integer("age_class").notNull(),
    finalizedAt: timestamp("finalized_at").defaultNow().notNull(),
  },
  (t) => [unique("endlauf26_finalizations_unique").on(t.eventId, t.ageClass)],
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
    finalizations: many(endlauf26Finalizations),
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

export const endlauf26FinalizationsRelations = relations(
  endlauf26Finalizations,
  ({ one }) => ({
    event: one(endlauf26Events, {
      fields: [endlauf26Finalizations.eventId],
      references: [endlauf26Events.id],
    }),
  }),
);
