# Sample demo output

Output of `pnpm demo` followed by `pnpm alerts:check`, run in a clean `node:24.21.0` container with a new Postgres 16 database, from commit [`5b89a68`](https://github.com/Mayankho/support-reliability-lab/commit/5b89a68). All customers, accounts, policies, and outcomes in these files are synthetic.

| File                                       | Contents                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| `index.html`                               | Side-by-side summary of the three runs                                           |
| `demo-summary.json`                        | Expected versus observed gate per version, run IDs, agent source hashes, blockers |
| `<version>/gate.json`                      | The gate artifact: status, blockers, metrics, denominators, thresholds, hashes    |
| `<version>/run-report.html`                | Readable run report with per-case rule results                                    |
| `incident-report.md`                       | The alert that fired on the blocked run and resolved on the repaired run          |

The full `run-report.json` for each run (about 420 KB, every rule verdict for all 80 cases) is not committed. Run `pnpm demo` to regenerate everything under `artifacts/demo/`. Run IDs and timestamps will differ. Hashes, outcomes, and blockers will not, unless the code or data changed.
