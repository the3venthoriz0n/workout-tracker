CREATE TABLE "user_ai_key" (
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"base_url" text,
	"model" text NOT NULL,
	"key_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_ai_key_user_id_pk" PRIMARY KEY("user_id"),
	CONSTRAINT "user_ai_key_provider_check" CHECK ("user_ai_key"."provider" in ('openai', 'anthropic'))
);
--> statement-breakpoint
ALTER TABLE "user_ai_key" ADD CONSTRAINT "user_ai_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;