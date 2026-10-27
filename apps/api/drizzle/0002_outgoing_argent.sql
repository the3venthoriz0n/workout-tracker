CREATE TABLE "plan_download" (
	"user_id" text NOT NULL,
	"shared_plan_id" uuid NOT NULL,
	"first_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_download_user_id_shared_plan_id_pk" PRIMARY KEY("user_id","shared_plan_id")
);
--> statement-breakpoint
CREATE TABLE "plan_vote" (
	"user_id" text NOT NULL,
	"shared_plan_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_vote_user_id_shared_plan_id_pk" PRIMARY KEY("user_id","shared_plan_id")
);
--> statement-breakpoint
CREATE TABLE "shared_plan" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"level" text,
	"status" text DEFAULT 'published' NOT NULL,
	"latest_version" integer NOT NULL,
	"upvote_count" integer DEFAULT 0 NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_plan_status_check" CHECK ("shared_plan"."status" in ('published', 'unpublished', 'hidden')),
	CONSTRAINT "shared_plan_level_check" CHECK ("shared_plan"."level" in ('beginner', 'intermediate', 'advanced')),
	CONSTRAINT "shared_plan_counts_check" CHECK ("shared_plan"."upvote_count" >= 0 and "shared_plan"."download_count" >= 0 and "shared_plan"."latest_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "shared_plan_version" (
	"shared_plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_plan_version_shared_plan_id_version_pk" PRIMARY KEY("shared_plan_id","version")
);
--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "source" jsonb;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "shared_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "plan_download" ADD CONSTRAINT "plan_download_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_download" ADD CONSTRAINT "plan_download_shared_plan_fk" FOREIGN KEY ("shared_plan_id") REFERENCES "public"."shared_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_vote" ADD CONSTRAINT "plan_vote_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_vote" ADD CONSTRAINT "plan_vote_shared_plan_fk" FOREIGN KEY ("shared_plan_id") REFERENCES "public"."shared_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_plan" ADD CONSTRAINT "shared_plan_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_plan_version" ADD CONSTRAINT "shared_plan_version_shared_plan_id_shared_plan_id_fk" FOREIGN KEY ("shared_plan_id") REFERENCES "public"."shared_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shared_plan_owner_idx" ON "shared_plan" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "shared_plan_top_idx" ON "shared_plan" USING btree ("upvote_count" DESC NULLS LAST,"download_count" DESC NULLS LAST,"updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "shared_plan"."status" = 'published';--> statement-breakpoint
CREATE INDEX "shared_plan_new_idx" ON "shared_plan" USING btree ("updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "shared_plan"."status" = 'published';--> statement-breakpoint
CREATE INDEX "shared_plan_used_idx" ON "shared_plan" USING btree ("download_count" DESC NULLS LAST,"upvote_count" DESC NULLS LAST,"updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "shared_plan"."status" = 'published';--> statement-breakpoint
CREATE INDEX "shared_plan_version_created_idx" ON "shared_plan_version" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_shared_plan_id_shared_plan_id_fk" FOREIGN KEY ("shared_plan_id") REFERENCES "public"."shared_plan"("id") ON DELETE set null ON UPDATE no action;