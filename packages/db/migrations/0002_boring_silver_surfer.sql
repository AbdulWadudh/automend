CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"kind" text NOT NULL,
	"display_name" text NOT NULL,
	"account_id" text,
	"account_user_id" uuid,
	"encrypted_secret" jsonb,
	"secret_hint" text,
	"scopes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_account_user_id_user_id_fk" FOREIGN KEY ("account_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connections_tenant_id_idx" ON "connections" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_tenant_provider_account_idx" ON "connections" USING btree ("tenant_id","provider_id","account_id") WHERE "connections"."account_id" is not null;