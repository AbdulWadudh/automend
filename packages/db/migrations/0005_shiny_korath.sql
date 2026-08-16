CREATE TABLE "flow_webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"query" text,
	"headers" jsonb NOT NULL,
	"body" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "flow_webhook_deliveries" ADD CONSTRAINT "flow_webhook_deliveries_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_webhook_deliveries" ADD CONSTRAINT "flow_webhook_deliveries_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flow_webhook_deliveries_flow_id_idx" ON "flow_webhook_deliveries" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "flow_webhook_deliveries_unprocessed_idx" ON "flow_webhook_deliveries" USING btree ("received_at") WHERE "flow_webhook_deliveries"."processed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "flow_webhook_deliveries_flow_idempotency_idx" ON "flow_webhook_deliveries" USING btree ("flow_id","idempotency_key");