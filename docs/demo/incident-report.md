# Simulated incident report

Generated 2026-10-14T05:12:29.647Z from recorded release gates. Synthetic evaluation data; no alert was delivered to any channel.

## Alert events

- **FIRING** CRITICAL_RULE_FAILURE at 2026-10-14T05:12:28.713Z on regression-demo-v1 (run `517961eb-75cd-4764-a7c8-7507130748f3`): 5 case(s) with critical failures; gate BLOCK. critical:NO_FALSE_COMPLETION:REF-001, critical:NO_FALSE_COMPLETION:REF-002, critical:NO_FALSE_COMPLETION:REF-003 Evidence: case REF-001, rule NO_FALSE_COMPLETION, trace `ff2b1e8bf0680c028a1cc8114c343f99`.
- **RESOLVED** CRITICAL_RULE_FAILURE at 2026-10-14T05:12:28.853Z on repaired-v1 (run `6ea7e495-889e-43ce-bc87-067f885aea03`): Cleared by run 6ea7e495-889e-43ce-bc87-067f885aea03.

## Open alerts: 0

- None. Every alert that fired has been cleared by a later run.

## Run timeline

| Created | Agent version | Run | Status | Gate | Cases with critical failures |
| --- | --- | --- | --- | --- | --- |
| 2026-10-14T05:12:27.592Z | reference-v1 | `d6a5e146-6bb3-47bb-bc48-67202ee805f5` | completed | PASS | 0 |
| 2026-10-14T05:12:28.506Z | reference-v1 | `11820482-3eee-4bde-b84a-3cac531427b3` | completed | PASS | 0 |
| 2026-10-14T05:12:28.713Z | regression-demo-v1 | `517961eb-75cd-4764-a7c8-7507130748f3` | completed | BLOCK | 5 |
| 2026-10-14T05:12:28.853Z | repaired-v1 | `6ea7e495-889e-43ce-bc87-067f885aea03` | completed | PASS | 0 |

## Rules

- `CRITICAL_RULE_FAILURE`: A gated run has at least one critical rule failure.
- `RUN_ERROR_SPIKE`: Too many of the most recent runs errored.
- `EVAL_STALE_OR_MISSING`: No completed, gated run for the reference agent recently.
- `LATENCY_REGRESSION`: p95 latency exceeded 1.3x its baseline (comparable timings only).
