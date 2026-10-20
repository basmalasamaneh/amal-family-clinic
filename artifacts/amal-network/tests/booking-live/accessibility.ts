import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** Same zero-violation gate as the shared harness, with safe selector evidence. */
export async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.map(v => ({
    id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target),
  }))).toEqual([]);
}
