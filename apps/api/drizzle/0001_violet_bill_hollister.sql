ALTER TABLE "exercise" ADD COLUMN "supports_angle" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "exercise" ADD COLUMN "default_rule" jsonb;--> statement-breakpoint
ALTER TABLE "plan_day" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "plan_item" ADD COLUMN "angle" text;--> statement-breakpoint
ALTER TABLE "plan_item" ADD COLUMN "amrap_last" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_item" ADD COLUMN "superset_group" uuid;--> statement-breakpoint
ALTER TABLE "plan_item" ADD COLUMN "inherit_rule" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "set_log" ADD COLUMN "angle" text;--> statement-breakpoint
ALTER TABLE "set_log" ADD COLUMN "amrap" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "set_log" ADD COLUMN "seq" integer;--> statement-breakpoint
ALTER TABLE "set_log" ADD COLUMN "superset_group" uuid;--> statement-breakpoint
ALTER TABLE "set_log" ADD COLUMN "superset_label" text;--> statement-breakpoint
ALTER TABLE "plan_day" ADD CONSTRAINT "plan_day_color_check" CHECK ("plan_day"."color" in ('blue', 'red', 'green', 'amber', 'violet', 'teal', 'pink', 'slate'));--> statement-breakpoint
ALTER TABLE "plan_item" ADD CONSTRAINT "plan_item_angle_check" CHECK ("plan_item"."angle" in ('flat', 'incline', 'decline'));