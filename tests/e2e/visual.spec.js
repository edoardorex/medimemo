import { test, expect } from '@playwright/test';
import { addDays, todayISO } from '../../src/domain.js';

test('cabinet layout stays readable at small and large widths', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 1100 });
  const today = todayISO();
  const medicines = [
    { id: 'sample-1', name: 'Allergy tablets', expiry: addDays(today, 18), reminderDays: 7, notes: 'Top shelf - unopened box', barcode: '' },
    { id: 'sample-2', name: 'First-aid cream', expiry: addDays(today, 140), reminderDays: 30, notes: 'Bathroom cabinet', barcode: '' },
    { id: 'sample-3', name: 'Travel tablets', expiry: addDays(today, -4), reminderDays: 14, notes: 'Check with a pharmacist about safe disposal', barcode: '' },
  ];
  await page.addInitScript((medicines) => {
    localStorage.setItem('medimemo.v1', JSON.stringify({ version: 1, medicines }));
  }, medicines);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('3');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const cabinet = await page.locator('.cabinet').boundingBox();
  const editor = await page.locator('.editor-panel').boundingBox();
  if (testInfo.project.name === 'desktop') {
    expect(Math.abs(cabinet.y - editor.y)).toBeLessThan(2);
  } else {
    expect(editor.y).toBeGreaterThan(cabinet.y + cabinet.height);
  }
  await page.screenshot({ path: testInfo.outputPath('cabinet.png'), fullPage: true });
});
