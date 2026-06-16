CREATE TYPE "public"."driver_type" AS ENUM('championship', 'vorstarter', 'gaststarter');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('upcoming', 'live', 'completed');--> statement-breakpoint
CREATE TYPE "public"."kart_type" AS ENUM('electric', 'gasoline');--> statement-breakpoint
CREATE TYPE "public"."run_type" AS ENUM('test', 'first', 'second');--> statement-breakpoint
CREATE TABLE "age_classes" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "age_classes_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"team_id" integer NOT NULL,
	"age_class_id" integer NOT NULL,
	"driver_type" "driver_type" DEFAULT 'championship' NOT NULL,
	"adac_id" text,
	"year_of_birth" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drivers_name_team_unique" UNIQUE("first_name","last_name","team_id")
);
--> statement-breakpoint
CREATE TABLE "event_age_class_finalizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_event_id" integer NOT NULL,
	"age_class_id" integer NOT NULL,
	"finalized_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "event_age_class_finalizations_unique" UNIQUE("race_event_id","age_class_id")
);
--> statement-breakpoint
CREATE TABLE "points_scale" (
	"place" integer PRIMARY KEY NOT NULL,
	"points" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "race_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_event_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"age_class_id" integer NOT NULL,
	"starting_order" integer,
	"finish_position" integer,
	"points_awarded" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "race_entries_event_driver_unique" UNIQUE("race_event_id","driver_id")
);
--> statement-breakpoint
CREATE TABLE "race_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"event_date" date NOT NULL,
	"name" text NOT NULL,
	"host_team_id" integer NOT NULL,
	"is_hmj" boolean DEFAULT false NOT NULL,
	"kart_type" "kart_type" NOT NULL,
	"status" "event_status" DEFAULT 'upcoming' NOT NULL,
	"live_age_class_id" integer,
	CONSTRAINT "race_events_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_entry_id" integer NOT NULL,
	"run_type" "run_type" NOT NULL,
	"time_seconds" numeric(8, 3),
	"penalty_seconds" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "runs_entry_type_unique" UNIQUE("race_entry_id","run_type")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "teams_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_age_class_id_age_classes_id_fk" FOREIGN KEY ("age_class_id") REFERENCES "public"."age_classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_age_class_finalizations" ADD CONSTRAINT "event_age_class_finalizations_race_event_id_race_events_id_fk" FOREIGN KEY ("race_event_id") REFERENCES "public"."race_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_age_class_finalizations" ADD CONSTRAINT "event_age_class_finalizations_age_class_id_age_classes_id_fk" FOREIGN KEY ("age_class_id") REFERENCES "public"."age_classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_entries" ADD CONSTRAINT "race_entries_race_event_id_race_events_id_fk" FOREIGN KEY ("race_event_id") REFERENCES "public"."race_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_entries" ADD CONSTRAINT "race_entries_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_entries" ADD CONSTRAINT "race_entries_age_class_id_age_classes_id_fk" FOREIGN KEY ("age_class_id") REFERENCES "public"."age_classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_events" ADD CONSTRAINT "race_events_host_team_id_teams_id_fk" FOREIGN KEY ("host_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_events" ADD CONSTRAINT "race_events_live_age_class_id_age_classes_id_fk" FOREIGN KEY ("live_age_class_id") REFERENCES "public"."age_classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_race_entry_id_race_entries_id_fk" FOREIGN KEY ("race_entry_id") REFERENCES "public"."race_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drivers_team_idx" ON "drivers" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "drivers_age_class_idx" ON "drivers" USING btree ("age_class_id");--> statement-breakpoint
CREATE INDEX "race_entries_event_idx" ON "race_entries" USING btree ("race_event_id");--> statement-breakpoint
CREATE INDEX "race_entries_driver_idx" ON "race_entries" USING btree ("driver_id");