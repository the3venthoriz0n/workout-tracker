CREATE TABLE "ai_usage" (
	"user_id" text NOT NULL,
	"usage_date" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_user_id_usage_date_pk" PRIMARY KEY("user_id","usage_date")
);
--> statement-breakpoint
CREATE TABLE "nutrition_entry" (
	"id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"quantity" text DEFAULT '' NOT NULL,
	"calories" numeric(8, 2),
	"protein_g" numeric(8, 2),
	"carbs_g" numeric(8, 2),
	"fat_g" numeric(8, 2),
	"fiber_g" numeric(8, 2),
	"sugar_g" numeric(8, 2),
	"sodium_mg" numeric(8, 2),
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "nutrition_entry_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "nutrition_entry_source_check" CHECK ("nutrition_entry"."source" in ('ai', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "nutrition" jsonb;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_entry" ADD CONSTRAINT "nutrition_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nutrition_entry_day_idx" ON "nutrition_entry" USING btree ("user_id","date");