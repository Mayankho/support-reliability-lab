# @srl/ticket-analysis

Triage for synthetic support conversations against a versioned issue taxonomy, and a map of what the 80 golden cases cover. It sits beside the evaluator, not inside it. Nothing in the agent, graders, gate, worker, API, or UI imports this package, and a boundary test keeps it that way.

All data here is synthetic or definitional. The taxonomy is a draft that has not been independently reviewed, and nothing in this package measures any production system.

## Taxonomy

`data/taxonomy.v1.1.json` (`issue-taxonomy-v1.1`, pinned in `data/taxonomy.manifest.json`):

| Level     | Count | Role                                                                                                               |
| --------- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| L1 domain | 15    | Derived from the issue type; never assigned directly                                                               |
| L2 issue  | 67    | The only primary label. One primary, at most one distinct secondary                                                |
| L3 option | 80    | Optional diagnosis under 24 issue types. Confirmed only by trusted evidence, never by a claim                      |
| Risk flag | 9     | Independent of the issue type: `F-SEC`, `F-LEG`, `F-MON`, `F-CHB`, `F-ABUSE`, `F-REG`, `F-OUT`, `F-CHURN`, `F-ENT` |

Each issue type carries a candidate fix home, automation tier, maximum automation scope, priority, and whether it typically involves a protected change such as a refund or credit grant. These are triage suggestions. The broadest scope is drafting a proposal for a human to approve, and nothing in the lab can execute a protected change.

```bash
pnpm tickets:validate-taxonomy    # hash, schema, counts, references, tie-break ranks
pnpm tickets:coverage             # crosswalk summary and gaps
pnpm tickets:coverage -- --write  # regenerate docs/TAXONOMY_COVERAGE_CROSSWALK.md
```

## Coverage crosswalk

`data/crosswalk.v1.json` maps each golden case to candidate issue types, flags, and the safety boundary it exercises. The rendered version, with the gap list, is [`docs/TAXONOMY_COVERAGE_CROSSWALK.md`](../../docs/TAXONOMY_COVERAGE_CROSSWALK.md). It is a single-author draft.

## Threads and triage

```text
raw records ─▶ parseMessages ─▶ groupThreads ─▶ triageThread ─▶ incident check ─▶ codes-only triage
               names, emails     order, report    current need,     F-OUT from
               dropped           anomalies        flags, L3, review  volume only
```

- **Primary issue:** the customer's central current need in the latest turn. A sentence that asks for something outranks one that only mentions a problem. For a failed or stuck job that cost credits, the requested remedy decides between `CRD-01` (credits back) and `PRC-01` (finish the job).
- **Context:** the body outranks the subject, and conflicts are recorded. Quoted history and agent replies never define the need. Follow-ups inherit the earlier need.
- **Flags:** decided independently of the issue type. `F-OUT` needs five threads with the same issue within an hour.
- **Evidence:** every item is tagged `customer_reported`, `agent_claimed`, `verified_synthetic_state`, or `inferred_pattern`. A diagnostic option is confirmed only by trusted synthetic state.
- **Abstention:** content outside the 21 rules (19 issue types, in English, Spanish, French, and German) gets an explicit abstention, and so does an unsupported language. There are no confidence scores.

The output holds codes only. Design notes are ADR-019 to ADR-022 in [`docs/DECISIONS.md`](../../docs/DECISIONS.md).

## Demo

```bash
pnpm tickets:demo     # 41 invented records; writes artifacts/tickets/triage.json
```

The demo exits 1 if any secret, name, email address, or message text from its input reaches its output. Its agreement figures compare against labels written by the rules' author alongside the rules, so they show consistency, not accuracy.

## Optional local-only import

`src/cli/local-import.ts` aggregates a real-format export for its owner, on their own machine. No script, CI job, or demo references it. It requires `--i-have-permission-to-process-this-file`, and absolute input and output paths outside the repository. It writes one `0600` summary of aggregate counts, with counts under ten suppressed, and no IDs or text. It has only ever been run on invented test records.
