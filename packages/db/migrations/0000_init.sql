CREATE TABLE "agent_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"source_hash" text NOT NULL,
	"policy_hash" text NOT NULL,
	"adapter_kind" text NOT NULL,
	"source_commit" text,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_versions_version_source_unique" UNIQUE("version","source_hash"),
	CONSTRAINT "agent_versions_adapter_kind_valid" CHECK ("agent_versions"."adapter_kind" in ('offline_deterministic', 'model'))
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"resource_id" text NOT NULL,
	"correlation_id" text NOT NULL,
	"details_json" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"status" text NOT NULL,
	"execution_state" text NOT NULL,
	"execution_error" text,
	"output_json" jsonb,
	"duration_ms" double precision NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(12, 6),
	"cost_source" text NOT NULL,
	"trace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_results_run_case_unique" UNIQUE("run_id","case_id"),
	CONSTRAINT "case_results_status_valid" CHECK ("case_results"."status" in ('pass', 'fail', 'error')),
	CONSTRAINT "case_results_execution_state_valid" CHECK ("case_results"."execution_state" in ('completed', 'error')),
	CONSTRAINT "case_results_duration_nonnegative" CHECK ("case_results"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" uuid NOT NULL,
	"case_key" text NOT NULL,
	"category" text NOT NULL,
	"risk" text NOT NULL,
	"input_json" jsonb NOT NULL,
	"available_policy_ids" jsonb NOT NULL,
	"expected_json" jsonb NOT NULL,
	"tags" jsonb NOT NULL,
	CONSTRAINT "cases_dataset_case_key_unique" UNIQUE("dataset_id","case_key"),
	CONSTRAINT "cases_risk_valid" CHECK ("cases"."risk" in ('critical', 'high', 'standard'))
);
--> statement-breakpoint
CREATE TABLE "datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"sha256" text NOT NULL,
	"case_count" integer NOT NULL,
	"policy_version" text NOT NULL,
	"policy_sha256" text NOT NULL,
	"review_status" text NOT NULL,
	"manifest_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "datasets_version_unique" UNIQUE("version"),
	CONSTRAINT "datasets_sha256_unique" UNIQUE("sha256"),
	CONSTRAINT "datasets_sha256_format" CHECK ("datasets"."sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "datasets_case_count_positive" CHECK ("datasets"."case_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "evaluation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"dataset_id" uuid NOT NULL,
	"agent_version_id" uuid NOT NULL,
	"baseline_run_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"gate_status" text,
	"gate_json" jsonb,
	"case_count" integer NOT NULL,
	"manifest_sha" text NOT NULL,
	"policy_sha" text NOT NULL,
	"evaluator_version" text NOT NULL,
	"config_json" jsonb NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "evaluation_runs_status_valid" CHECK ("evaluation_runs"."status" in ('queued', 'running', 'completed', 'errored', 'cancelled')),
	CONSTRAINT "evaluation_runs_gate_status_valid" CHECK ("evaluation_runs"."gate_status" is null or "evaluation_runs"."gate_status" in ('PASS', 'BLOCK', 'ERROR'))
);
--> statement-breakpoint
CREATE TABLE "rule_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_result_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"verdict" text NOT NULL,
	"severity" text NOT NULL,
	"evaluator_version" text NOT NULL,
	"evidence_code" text NOT NULL,
	"evidence_json" jsonb NOT NULL,
	CONSTRAINT "rule_results_case_rule_unique" UNIQUE("case_result_id","rule_id"),
	CONSTRAINT "rule_results_verdict_valid" CHECK ("rule_results"."verdict" in ('pass', 'fail', 'error', 'not_applicable')),
	CONSTRAINT "rule_results_severity_valid" CHECK ("rule_results"."severity" in ('critical', 'high', 'standard'))
);
--> statement-breakpoint
CREATE TABLE "run_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"worker_id" text,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_jobs_run_unique" UNIQUE("run_id"),
	CONSTRAINT "run_jobs_status_valid" CHECK ("run_jobs"."status" in ('queued', 'leased', 'done', 'failed')),
	CONSTRAINT "run_jobs_attempts_valid" CHECK ("run_jobs"."attempts" >= 0 and "run_jobs"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE "trace_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"case_id" uuid,
	"trace_id" text NOT NULL,
	"span_id" text NOT NULL,
	"kind" text NOT NULL,
	"redacted_attributes_json" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_results" ADD CONSTRAINT "case_results_run_id_evaluation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_results" ADD CONSTRAINT "case_results_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_results" ADD CONSTRAINT "rule_results_case_result_id_case_results_id_fk" FOREIGN KEY ("case_result_id") REFERENCES "public"."case_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_jobs" ADD CONSTRAINT "run_jobs_run_id_evaluation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_events_run_id_evaluation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_resource_idx" ON "audit_events" USING btree ("resource_id","occurred_at");--> statement-breakpoint
CREATE INDEX "evaluation_runs_created_status_idx" ON "evaluation_runs" USING btree ("created_at" DESC NULLS LAST,"status");--> statement-breakpoint
CREATE INDEX "rule_results_lookup_idx" ON "rule_results" USING btree ("case_result_id","verdict","severity");--> statement-breakpoint
CREATE INDEX "run_jobs_status_lease_idx" ON "run_jobs" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "trace_events_run_idx" ON "trace_events" USING btree ("run_id","occurred_at");