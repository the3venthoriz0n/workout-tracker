CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise" (
	"id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"video_url" text,
	"required_gear_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"default_sets" integer NOT NULL,
	"default_reps" integer NOT NULL,
	"default_weight" numeric(8, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "exercise_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "gear" (
	"id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"owned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "gear_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "item_state" (
	"user_id" text NOT NULL,
	"plan_item_id" uuid NOT NULL,
	"fail_streak" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "item_state_user_id_plan_item_id_pk" PRIMARY KEY("user_id","plan_item_id")
);
--> statement-breakpoint
CREATE TABLE "plan" (
	"id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "plan_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "plan_day" (
	"id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "plan_day_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "plan_item" (
	"id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"plan_day_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"sets" integer,
	"reps" integer,
	"weight" numeric(8, 2),
	"target_reps" integer,
	"target_weight" numeric(8, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "plan_item_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"user_id" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"units" text DEFAULT 'lb' NOT NULL,
	"weight_increment" numeric(8, 2) NOT NULL,
	"default_rule" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "profile_user_id_pk" PRIMARY KEY("user_id"),
	CONSTRAINT "profile_plan_check" CHECK ("profile"."plan" in ('free', 'pro')),
	CONSTRAINT "profile_units_check" CHECK ("profile"."units" in ('lb', 'kg')),
	CONSTRAINT "profile_increment_check" CHECK ("profile"."weight_increment" > 0)
);
--> statement-breakpoint
CREATE TABLE "progression_rule" (
	"user_id" text NOT NULL,
	"plan_item_id" uuid NOT NULL,
	"success_action" text NOT NULL,
	"success_amount" numeric(8, 2) NOT NULL,
	"fail_streak_limit" integer NOT NULL,
	"deload_pct" numeric(5, 2) NOT NULL,
	"rep_ceiling" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "progression_rule_user_id_plan_item_id_pk" PRIMARY KEY("user_id","plan_item_id"),
	CONSTRAINT "progression_rule_action_check" CHECK ("progression_rule"."success_action" in ('add_weight', 'add_reps'))
);
--> statement-breakpoint
CREATE TABLE "set_log" (
	"id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"plan_item_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"exercise_name" text NOT NULL,
	"set_no" integer NOT NULL,
	"position" integer NOT NULL,
	"target_reps" integer NOT NULL,
	"target_weight" numeric(8, 2) NOT NULL,
	"actual_reps" integer NOT NULL,
	"weight" numeric(8, 2) NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "set_log_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "workout_session" (
	"id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"plan_day_id" uuid NOT NULL,
	"plan_name" text NOT NULL,
	"day_name" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workout_session_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise" ADD CONSTRAINT "exercise_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gear" ADD CONSTRAINT "gear_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_state" ADD CONSTRAINT "item_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_state" ADD CONSTRAINT "item_state_plan_item_fk" FOREIGN KEY ("user_id","plan_item_id") REFERENCES "public"."plan_item"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_day" ADD CONSTRAINT "plan_day_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_day" ADD CONSTRAINT "plan_day_plan_fk" FOREIGN KEY ("user_id","plan_id") REFERENCES "public"."plan"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_item" ADD CONSTRAINT "plan_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_item" ADD CONSTRAINT "plan_item_plan_day_fk" FOREIGN KEY ("user_id","plan_day_id") REFERENCES "public"."plan_day"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_item" ADD CONSTRAINT "plan_item_exercise_fk" FOREIGN KEY ("user_id","exercise_id") REFERENCES "public"."exercise"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progression_rule" ADD CONSTRAINT "progression_rule_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progression_rule" ADD CONSTRAINT "progression_rule_plan_item_fk" FOREIGN KEY ("user_id","plan_item_id") REFERENCES "public"."plan_item"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_log" ADD CONSTRAINT "set_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_log" ADD CONSTRAINT "set_log_session_fk" FOREIGN KEY ("user_id","session_id") REFERENCES "public"."workout_session"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_session" ADD CONSTRAINT "workout_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_session_one_active_idx" ON "workout_session" USING btree ("user_id") WHERE "workout_session"."completed_at" is null and "workout_session"."deleted_at" is null;