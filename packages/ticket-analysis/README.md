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

`data/crosswalk.v1.json` maps each golden case to candidate issue types, flags, and the safety boundary it exercises. The rendered version, with the gap list, is [`docs/TAXONOMY_COVERAGE_CROSSWALK.md`](../../docs/TAXONOMY_COVERAGE_CROSSWALK.md). It is a single-author draft. Design notes are in ADR-019 in [`docs/DECISIONS.md`](../../docs/DECISIONS.md).
