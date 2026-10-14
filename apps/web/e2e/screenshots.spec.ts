import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { E2E, STATE_FILE, type E2EState } from './env.ts';

const OUT = process.env.SRL_SCREENSHOT_DIR;
test.skip(OUT === undefined, 'set SRL_SCREENSHOT_DIR to capture documentation screenshots');

const secured = `http://127.0.0.1:${String(E2E.jwtWebPort)}`;

async function capture(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT ?? '', `${name}.png`), fullPage: true });
}

test('captures the four review views as a reviewer', async ({ page }) => {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2EState;
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(`${secured}/`);
  await page.getByLabel('API token').fill(state.tokens.reviewer);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByRole('row').filter({ hasText: 'regression-demo-v1' }).first(),
  ).toBeVisible();

  await page.goto(`${secured}/#/runs/${state.regressionRunId}/gate`);
  await expect(page.getByRole('heading', { name: /Blockers/u })).toBeVisible();
  await capture(page, 'release-decision');

  await page.goto(`${secured}/#/runs/${state.regressionRunId}/cases/REF-001`);
  await expect(
    page.getByRole('region', { name: 'Expected and actual behavior' }).getByRole('row', {
      name: /^decision/u,
    }),
  ).toContainText('propose_action');
  await capture(page, 'case-detail');

  await page.goto(
    `${secured}/#/compare?candidate=${state.regressionRunId}&baseline=${state.referenceRunId}`,
  );
  await expect(page.getByRole('heading', { name: /New failures/u })).toBeVisible();
  await capture(page, 'comparison');

  await page.goto(`${secured}/#/runs/${state.regressionRunId}`);
  await page.getByLabel('Failing rule').selectOption('NO_FALSE_COMPLETION');
  await expect(page.getByText('5 matching case(s).')).toBeVisible();
  await capture(page, 'run-overview');
});
