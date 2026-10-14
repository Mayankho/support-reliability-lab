import { readTaxonomy } from '../taxonomy/load.ts';

function main(): number {
  const result = readTaxonomy();
  if (!result.ok) {
    process.stdout.write('taxonomy: INVALID\n');
    for (const issue of result.issues) process.stdout.write(`  ${issue.code}: ${issue.detail}\n`);
    return 1;
  }
  const { taxonomy, sha256, l3ByParent } = result.value;
  const scopes = new Map<string, number>();
  for (const issue of taxonomy.l2Issues) {
    scopes.set(issue.maxAutomationScope, (scopes.get(issue.maxAutomationScope) ?? 0) + 1);
  }
  const protectedCount = taxonomy.l2Issues.filter(
    (i) => i.protectedMutationTypicallyInvolved,
  ).length;
  process.stdout.write(
    [
      `taxonomy ${taxonomy.taxonomyVersion}: VALID`,
      `  sha256: ${sha256}`,
      `  review status: ${taxonomy.reviewStatus}`,
      `  L1 domains: ${String(taxonomy.l1Domains.length)}, L2 issue types: ${String(taxonomy.l2Issues.length)}, L3 options: ${String(taxonomy.l3Options.length)} under ${String(l3ByParent.size)} issue types, risk flags: ${String(taxonomy.riskFlags.length)}`,
      `  automation scope caps: ${[...scopes].map(([scope, count]) => `${scope} (${String(count)})`).join('; ')}`,
      `  issue types that typically involve a protected mutation: ${String(protectedCount)}. The lab has no executor for any of them.`,
      '',
    ].join('\n'),
  );
  return 0;
}

process.exitCode = main();
