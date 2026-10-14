-- Evidence guarantees that the ORM schema cannot express.

ALTER TABLE "evaluation_runs"
  ADD CONSTRAINT "evaluation_runs_baseline_run_id_fk"
  FOREIGN KEY ("baseline_run_id") REFERENCES "evaluation_runs"("id");
--> statement-breakpoint

-- What the worker reads to build agent input. Gold labels are not in it.
CREATE VIEW "case_inputs" AS
  SELECT "id", "dataset_id", "case_key", "category", "risk", "input_json", "available_policy_ids"
  FROM "cases";
--> statement-breakpoint

CREATE FUNCTION srl_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: rows are immutable evidence', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END
$$;
--> statement-breakpoint

CREATE TRIGGER "datasets_immutable" BEFORE UPDATE OR DELETE ON "datasets"
  FOR EACH ROW EXECUTE FUNCTION srl_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "cases_immutable" BEFORE UPDATE OR DELETE ON "cases"
  FOR EACH ROW EXECUTE FUNCTION srl_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "agent_versions_immutable" BEFORE UPDATE OR DELETE ON "agent_versions"
  FOR EACH ROW EXECUTE FUNCTION srl_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "case_results_immutable" BEFORE UPDATE OR DELETE ON "case_results"
  FOR EACH ROW EXECUTE FUNCTION srl_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "rule_results_immutable" BEFORE UPDATE OR DELETE ON "rule_results"
  FOR EACH ROW EXECUTE FUNCTION srl_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "trace_events_append_only" BEFORE UPDATE OR DELETE ON "trace_events"
  FOR EACH ROW EXECUTE FUNCTION srl_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "audit_events_append_only" BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION srl_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "evaluation_runs_no_delete" BEFORE DELETE ON "evaluation_runs"
  FOR EACH ROW EXECUTE FUNCTION srl_reject_mutation();
--> statement-breakpoint

-- Results may only be added while a run is executing.
CREATE FUNCTION srl_guard_result_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  run_status text;
BEGIN
  SELECT "status" INTO run_status FROM "evaluation_runs" WHERE "id" = NEW."run_id";
  IF run_status IS DISTINCT FROM 'running' THEN
    RAISE EXCEPTION 'cannot add results to run % in status %', NEW."run_id", run_status
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "case_results_run_open" BEFORE INSERT ON "case_results"
  FOR EACH ROW EXECUTE FUNCTION srl_guard_result_insert();
--> statement-breakpoint

-- Allowed lifecycle: queued -> running -> completed | errored | cancelled (queued may also be
-- cancelled or errored). A finished run is frozen except that its gate may be recorded once.
CREATE FUNCTION srl_guard_run_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" IN ('completed', 'errored', 'cancelled') THEN
    IF NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."dataset_id" IS DISTINCT FROM OLD."dataset_id"
      OR NEW."agent_version_id" IS DISTINCT FROM OLD."agent_version_id"
      OR NEW."baseline_run_id" IS DISTINCT FROM OLD."baseline_run_id"
      OR NEW."case_count" IS DISTINCT FROM OLD."case_count"
      OR NEW."manifest_sha" IS DISTINCT FROM OLD."manifest_sha"
      OR NEW."policy_sha" IS DISTINCT FROM OLD."policy_sha"
      OR NEW."evaluator_version" IS DISTINCT FROM OLD."evaluator_version"
      OR NEW."config_json" IS DISTINCT FROM OLD."config_json"
      OR NEW."error_code" IS DISTINCT FROM OLD."error_code"
      OR NEW."started_at" IS DISTINCT FROM OLD."started_at"
      OR NEW."finished_at" IS DISTINCT FROM OLD."finished_at"
      OR (OLD."gate_status" IS NOT NULL
        AND (NEW."gate_status" IS DISTINCT FROM OLD."gate_status"
          OR NEW."gate_json" IS DISTINCT FROM OLD."gate_json")) THEN
      RAISE EXCEPTION 'evaluation run % is finalized', OLD."id" USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."gate_status" IS NOT NULL AND NEW."gate_json" IS NULL THEN
      RAISE EXCEPTION 'gate status requires a gate artifact' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."gate_status" IS NOT NULL OR NEW."gate_json" IS NOT NULL THEN
    RAISE EXCEPTION 'gate can only be recorded after run % finishes', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT (
    NEW."status" = OLD."status"
    OR (OLD."status" = 'queued' AND NEW."status" IN ('running', 'errored', 'cancelled'))
    OR (OLD."status" = 'running' AND NEW."status" IN ('completed', 'errored', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'invalid run transition % -> %', OLD."status", NEW."status"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "evaluation_runs_guard" BEFORE UPDATE ON "evaluation_runs"
  FOR EACH ROW EXECUTE FUNCTION srl_guard_run_update();
