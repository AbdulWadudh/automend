CREATE TABLE "flow_run_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"definition_snapshot" jsonb NOT NULL,
	"trigger_payload" jsonb,
	"error" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_step_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"step_name" text NOT NULL,
	"kit_id" text NOT NULL,
	"action_name" text NOT NULL,
	"status" text NOT NULL,
	"attempt" integer NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "flow_trigger_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"trigger_id" uuid NOT NULL,
	"kit_id" text NOT NULL,
	"trigger_name" text NOT NULL,
	"strategy" text NOT NULL,
	"schedule" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kit_stores" (
	"tenant_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"trigger_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kit_stores_tenant_id_flow_id_trigger_id_key_pk" PRIMARY KEY("tenant_id","flow_id","trigger_id","key")
);
--> statement-breakpoint
ALTER TABLE "flow_run_outbox" ADD CONSTRAINT "flow_run_outbox_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_run_outbox" ADD CONSTRAINT "flow_run_outbox_run_id_flow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."flow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_step_runs" ADD CONSTRAINT "flow_step_runs_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_step_runs" ADD CONSTRAINT "flow_step_runs_run_id_flow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."flow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_trigger_registrations" ADD CONSTRAINT "flow_trigger_registrations_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_trigger_registrations" ADD CONSTRAINT "flow_trigger_registrations_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_stores" ADD CONSTRAINT "kit_stores_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_stores" ADD CONSTRAINT "kit_stores_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flow_run_outbox_unpublished_idx" ON "flow_run_outbox" USING btree ("created_at") WHERE "flow_run_outbox"."published_at" is null;--> statement-breakpoint
CREATE INDEX "flow_run_outbox_run_id_idx" ON "flow_run_outbox" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "flow_runs_flow_created_idx" ON "flow_runs" USING btree ("flow_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "flow_runs_tenant_id_idx" ON "flow_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_runs_flow_idempotency_idx" ON "flow_runs" USING btree ("flow_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "flow_step_runs_run_id_idx" ON "flow_step_runs" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_step_runs_run_step_attempt_idx" ON "flow_step_runs" USING btree ("run_id","step_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_trigger_registrations_flow_idx" ON "flow_trigger_registrations" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "flow_trigger_registrations_strategy_idx" ON "flow_trigger_registrations" USING btree ("strategy") WHERE "flow_trigger_registrations"."enabled";