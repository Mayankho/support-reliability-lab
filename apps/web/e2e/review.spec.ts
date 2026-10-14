import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { E2E, STATE_FILE, type E2EState } from './env.ts';

const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2EState;
const local = `http://127.0.0.1:${String(E2E.localWebPort)}`;
const secured = `http://127.0.0.1:${String(E2E.jwtWebPort)}`;

test('drills from a blocked run to the failing case and its evidence', async ({
  page,
}, testInfo) => {
  await page.goto(`${local}/`);
  await expect(page.getByRole('heading', { name: 'Evaluation runs' })).toBeVisible();

  const regressionRow = page.getByRole('row').filter({ hasText: 'regression-demo-v1' }).first();
  await expect(regressionRow).toContainText('BLOCK: release stopped');
  await regressionRow.getByRole('link', { name: 'regression-demo-v1' }).click();

  const summary = page.getByRole('region', { name: /regression-demo-v1/u });
  await expect(summary).toContainText('80 of 80');
  await expect(summary).toContainText('Cases with critical failures5');
  await page
    .getByRole('link', { name: 'critical:NO_FALSE_COMPLETION:REF-001', exact: true })
    .click();

  await expect(page.getByRole('heading', { name: /REF-001/u })).toBeVisible();
  await expect(page.getByRole('region', { name: /Triggered rules/u })).toContainText(
    'NO_FALSE_COMPLETION',
  );
  await expect(page.getByText("Done! I've refunded your credit purchase")).toBeVisible();
  await expect(
    page.getByText('Suggested fix layer (hypothesis, needs human review): prompt'),
  ).toBeVisible();
  await expect(
    page.getByText('Expected values are shown only to authenticated reviewers.'),
  ).toBeVisible();
  await expect(page.locator('.timeline li').first()).toContainText('eval.case');

  await testInfo.attach('failure-drilldown', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('shows the release decision and the paired comparison for the blocked run', async ({
  page,
}) => {
  await page.goto(`${local}/#/runs/${state.regressionRunId}`);
  await page.getByRole('link', { name: 'Release decision' }).click();
  await expect(page.getByText(/Promotion blocked: the evidence is complete/u)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Blockers (10)' })).toBeVisible();

  await page.goto(`${local}/#/runs/${state.regressionRunId}`);
  await page.getByRole('link', { name: 'Compare with baseline' }).click();
  await expect(page.getByRole('heading', { name: 'New failures (5)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fixed cases (0)' })).toBeVisible();
});

test('filters cases by failing rule with the keyboard', async ({ page }) => {
  await page.goto(`${local}/#/runs/${state.regressionRunId}`);
  const ruleFilter = page.getByLabel('Failing rule');
  await ruleFilter.focus();
  await ruleFilter.selectOption('NO_FALSE_COMPLETION');
  await expect(page.getByText('5 matching case(s).')).toBeVisible();
});

test('rejects unauthenticated access and scopes authenticated access', async ({
  page,
  request,
}) => {
  const apiBase = `http://127.0.0.1:${String(E2E.jwtApiPort)}`;
  const anonymous = await request.get(`${apiBase}/api/v1/evaluation-runs`);
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()['www-authenticate']).toBe('Bearer');

  const crossTenant = await request.get(
    `${apiBase}/api/v1/evaluation-runs/${state.regressionRunId}`,
    {
      headers: { authorization: `Bearer ${state.tokens.otherWorkspaceViewer}` },
    },
  );
  expect(crossTenant.status()).toBe(404);

  await page.goto(`${secured}/`);
  await expect(page.getByRole('alert')).toContainText('Sign-in required.');

  await page.getByLabel('API token').fill(state.tokens.reviewer);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByRole('row').filter({ hasText: 'regression-demo-v1' }).first(),
  ).toBeVisible();

  await page.goto(`${secured}/#/runs/${state.regressionRunId}/cases/REF-001`);
  const behavior = page.getByRole('region', { name: 'Expected and actual behavior' });
  await expect(behavior.getByRole('row', { name: /^decision/u })).toContainText('propose_action');
  await expect(behavior).not.toContainText('reviewers only');
});
