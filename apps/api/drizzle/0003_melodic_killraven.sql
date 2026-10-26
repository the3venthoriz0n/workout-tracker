ALTER TABLE "shared_plan_version" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "shared_plan_version" ADD COLUMN "no_gear" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shared_plan_version" ADD COLUMN "day_count" integer DEFAULT 0 NOT NULL;