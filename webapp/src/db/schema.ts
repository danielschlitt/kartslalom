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

export const driverTypeEnum = pgEnum("driver_type", [
  "championship",
  "vorstarter",
  "gaststarter",
]);

export const kartTypeEnum = pgEnum("kart_type", ["electric", "gasoline"]);

export const eventStatusEnum = pgEnum("event_status", [
  "upcoming",
  "live",
  "completed",
]);

export const runTypeEnum = pgEnum("run_type", ["test", "first", "second"]);

export const ageClasses = pgTable("age_classes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull(),
});

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const drivers = pgTable(
  "drivers",
  {
    id: serial("id").primaryKey(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    ageClassId: integer("age_class_id")
      .notNull()
      .references(() => ageClasses.id, { onDelete: "restrict" }),
    driverType: driverTypeEnum("driver_type")
      .notNull()
      .default("championship"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("drivers_team_idx").on(table.teamId),
    index("drivers_age_class_idx").on(table.ageClassId),
    unique("drivers_name_team_unique").on(
      table.firstName,
      table.lastName,
      table.teamId,
    ),
  ],
);

export const raceEvents = pgTable("race_events", {
  id: serial("id").primaryKey(),
  number: integer("number").notNull().unique(),
  eventDate: date("event_date").notNull(),
  name: text("name").notNull(),
  hostTeamId: integer("host_team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "restrict" }),
  isHmj: boolean("is_hmj").notNull().default(false),
  kartType: kartTypeEnum("kart_type").notNull(),
  status: eventStatusEnum("status").notNull().default("upcoming"),
});

export const raceEntries = pgTable(
  "race_entries",
  {
    id: serial("id").primaryKey(),
    raceEventId: integer("race_event_id")
      .notNull()
      .references(() => raceEvents.id, { onDelete: "cascade" }),
    driverId: integer("driver_id")
      .notNull()
      .references(() => drivers.id, { onDelete: "cascade" }),
    ageClassId: integer("age_class_id")
      .notNull()
      .references(() => ageClasses.id, { onDelete: "restrict" }),
    startingOrder: integer("starting_order"),
    finishPosition: integer("finish_position"),
    pointsAwarded: integer("points_awarded").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("race_entries_event_idx").on(table.raceEventId),
    index("race_entries_driver_idx").on(table.driverId),
    unique("race_entries_event_driver_unique").on(
      table.raceEventId,
      table.driverId,
    ),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: serial("id").primaryKey(),
    raceEntryId: integer("race_entry_id")
      .notNull()
      .references(() => raceEntries.id, { onDelete: "cascade" }),
    runType: runTypeEnum("run_type").notNull(),
    timeSeconds: numeric("time_seconds", { precision: 8, scale: 3 }),
    penaltySeconds: integer("penalty_seconds").notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("runs_entry_type_unique").on(table.raceEntryId, table.runType),
  ],
);

export const pointsScale = pgTable("points_scale", {
  place: integer("place").primaryKey(),
  points: integer("points").notNull(),
});

// Relations
export const teamsRelations = relations(teams, ({ many }) => ({
  drivers: many(drivers),
  hostedEvents: many(raceEvents),
}));

export const ageClassesRelations = relations(ageClasses, ({ many }) => ({
  drivers: many(drivers),
  raceEntries: many(raceEntries),
}));

export const driversRelations = relations(drivers, ({ one, many }) => ({
  team: one(teams, { fields: [drivers.teamId], references: [teams.id] }),
  ageClass: one(ageClasses, {
    fields: [drivers.ageClassId],
    references: [ageClasses.id],
  }),
  raceEntries: many(raceEntries),
}));

export const raceEventsRelations = relations(raceEvents, ({ one, many }) => ({
  hostTeam: one(teams, {
    fields: [raceEvents.hostTeamId],
    references: [teams.id],
  }),
  raceEntries: many(raceEntries),
}));

export const raceEntriesRelations = relations(raceEntries, ({ one, many }) => ({
  raceEvent: one(raceEvents, {
    fields: [raceEntries.raceEventId],
    references: [raceEvents.id],
  }),
  driver: one(drivers, {
    fields: [raceEntries.driverId],
    references: [drivers.id],
  }),
  ageClass: one(ageClasses, {
    fields: [raceEntries.ageClassId],
    references: [ageClasses.id],
  }),
  runs: many(runs),
}));

export const runsRelations = relations(runs, ({ one }) => ({
  raceEntry: one(raceEntries, {
    fields: [runs.raceEntryId],
    references: [raceEntries.id],
  }),
}));
