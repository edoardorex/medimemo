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
    expect(editor).toBeNull();
    await expect(page.getByRole('navigation', { name: 'Mobile cabinet actions' })).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath('cabinet.png'), fullPage: true });
});

test('a 320px phone uses a full-width sheet and preserves an edit when resized', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await expect(page.locator('.editor-panel')).not.toBeVisible();
  await page.locator('#mobile-add').click();
  await expect(page.locator('#mobile-editor')).toBeVisible();
  expect((await page.locator('#mobile-editor').boundingBox()).width).toBe(320);
  expect(await page.getByLabel('Medicine name').evaluate((input) => getComputedStyle(input).fontSize)).toBe('16px');
  await page.getByLabel('Medicine name').fill('A longer medicine name for a small-screen cabinet');
  await page.getByLabel('Expiry date').fill('2090-01-15');
  await page.locator('#mobile-editor').evaluate((dialog) => { dialog.scrollTop = dialog.scrollHeight; });
  await expect(page.getByRole('button', { name: 'Close medicine form' })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath('editor.png') });
  await page.getByRole('button', { name: 'Save to my cabinet' }).click();
  await expect(page.locator('#mobile-editor')).not.toBeVisible();
  await expect(page.locator('.medicine-card')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Edit A longer medicine name for a small-screen cabinet', exact: true }).click();
  await expect(page.getByLabel('Medicine name', { exact: true })).toHaveValue('A longer medicine name for a small-screen cabinet');
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect(page.locator('#mobile-editor')).not.toBeVisible();
  await expect(page.locator('.workspace .editor-panel')).toBeVisible();
  await expect(page.getByLabel('Medicine name', { exact: true })).toHaveValue('A longer medicine name for a small-screen cabinet');
});
