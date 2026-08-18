ALTER TABLE "flow_runs" ADD COLUMN "retry_of_run_id" uuid;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_retry_of_run_id_flow_runs_id_fk" FOREIGN KEY ("retry_of_run_id") REFERENCES "public"."flow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flow_runs_tenant_created_idx" ON "flow_runs" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "flow_runs_retry_of_idx" ON "flow_runs" USING btree ("retry_of_run_id") WHERE "flow_runs"."retry_of_run_id" is not null;