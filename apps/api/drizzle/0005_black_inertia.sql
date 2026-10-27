ALTER TABLE "shared_plan" DROP CONSTRAINT "shared_plan_owner_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "shared_plan" ALTER COLUMN "owner_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "shared_plan" ADD CONSTRAINT "shared_plan_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;