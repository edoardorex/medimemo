import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { BarcodeFormat, DataMatrixWriter } from '@zxing/library';

async function addMedicine(page, name = 'Allergy tablets', expiry = '2090-01-15') {
  if (!await page.getByLabel('Medicine name').isVisible()) await page.locator('#hero-add').click();
  await page.getByLabel('Medicine name').fill(name);
  await page.getByLabel('Expiry date').fill(expiry);
  await page.getByRole('button', { name: 'Save to my cabinet' }).click();
}

async function startCamera(page) {
  const button = page.getByRole('button', { name: 'Scan with your camera' });
  if (await button.isVisible()) await button.click();
  else await page.locator('#mobile-scan').click();
}

test('save, reload, edit, filter, calendar and delete work without a backend', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('A fresh start for your cabinet.')).toBeVisible();
  await addMedicine(page);
  await expect(page.locator('#stat-total')).toHaveText('1');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Allergy tablets', exact: true })).toBeVisible();
  const link = page.getByRole('link', { name: 'Add Google Calendar reminder for Allergy tablets' });
  const url = new URL(await link.getAttribute('href'));
  expect(url.searchParams.get('dates')).toBe('20891216/20891217');
  expect(url.searchParams.get('text')).toBe('Medicine expiry: Allergy tablets');
  await page.getByRole('button', { name: 'Edit Allergy tablets', exact: true }).click();
  await page.getByLabel('Medicine name').fill('Travel tablets');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Expired', exact: true }).click();
  await expect(page.getByText('No matches just yet.')).toBeVisible();
  await page.getByRole('button', { name: 'All medicines', exact: true }).click();
  await page.getByRole('searchbox').fill('not found');
  await expect(page.getByText('No matches just yet.')).toBeVisible();
  await page.getByRole('searchbox').fill('');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete Travel tablets', exact: true }).click();
  await expect(page.locator('#stat-total')).toHaveText('0');
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('expired medicines have no Calendar link and unsafe text is rendered literally', async ({ page }) => {
  await page.goto('/');
  await addMedicine(page, '<img src=x onerror=alert(1)>', '2020-01-01');
  await expect(page.locator('#stat-expired')).toHaveText('1');
  await expect(page.getByRole('heading', { name: '<img src=x onerror=alert(1)>' })).toBeVisible();
  await expect(page.locator('.medicine-card img')).toHaveCount(0);
  await expect(page.locator('.calendar-link')).toHaveCount(0);
});

test('denied camera permission provides a manual fallback', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
  });
  await page.goto('/');
  await startCamera(page);
  await expect(page.locator('#scanner-dialog')).toBeVisible();
  await expect(page.locator('#scan-status')).toContainText('Camera permission was denied');
  await page.getByRole('button', { name: 'Use manual entry instead' }).click();
  await expect(page.locator('#scanner-dialog')).not.toBeVisible();
  await expect(page.getByLabel('Medicine name')).toBeFocused();
});

test('export and import preserve a cabinet and invalid backups leave data untouched', async ({ page }) => {
  await page.goto('/');
  await addMedicine(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^medimemo-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const backup = Buffer.concat(chunks);
  expect(JSON.parse(backup).medicines[0].name).toBe('Allergy tablets');
  await page.locator('#import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":2,"medicines":[]}') });
  await expect(page.locator('#notice')).toContainText('Could not import');
  await expect(page.locator('#stat-total')).toHaveText('1');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#import-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
  await expect(page.locator('#notice')).toHaveText('Backup restored.');
  await expect(page.locator('#stat-total')).toHaveText('1');
});

test('unreadable storage is protected until an explicit reset', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('medimemo.v1', '{broken'));
  await page.goto('/');
  await expect(page.locator('#storage-error')).toBeVisible();
  await expect(page.getByLabel('Medicine name')).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('medimemo.v1'))).toBe('{broken');
  await page.locator('#hero-add').click();
  await expect(page.locator('#notice')).toContainText('Restore a backup using Import');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reset local data' }).click();
  await expect(page.getByLabel('Medicine name')).toBeEnabled();
  await expect(page.locator('#storage-error')).not.toBeVisible();
});

test('storage write failures never report a successful save', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
  });
  await page.goto('/');
  await addMedicine(page);
  await expect(page.locator('#notice')).toContainText('Your change was not saved');
  await expect(page.locator('#stat-total')).toHaveText('0');
  await expect(page.getByLabel('Medicine name')).toHaveValue('Allergy tablets');
});

test('empty and populated layouts meet automated accessibility checks', async ({ page }) => {
  await page.goto('/');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await addMedicine(page);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('a Data Matrix camera frame is decoded into a GS1 expiry and the camera is released', async ({ page }) => {
  const matrix = new DataMatrixWriter().encode('01095060001343521727063010LOT42', BarcodeFormat.DATA_MATRIX, 0, 0, new Map());
  const pixels = Array.from({ length: matrix.getHeight() }, (_, y) =>
    Array.from({ length: matrix.getWidth() }, (_, x) => matrix.get(x, y)));
  await page.addInitScript((pixels) => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const context = canvas.getContext('2d');
      const stream = canvas.captureStream(10);
      window.testCameraTracks = stream.getTracks();
      const draw = () => {
        context.fillStyle = 'white';
        context.fillRect(0, 0, 640, 480);
        context.fillStyle = 'black';
        const size = 12;
        const left = (640 - pixels[0].length * size) / 2;
        const top = (480 - pixels.length * size) / 2;
        pixels.forEach((row, y) => row.forEach((pixel, x) => {
          if (pixel) context.fillRect(left + x * size, top + y * size, size, size);
        }));
        if (stream.getTracks().some((track) => track.readyState === 'live')) requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
      return stream;
    };
  }, pixels);
  await page.goto('/');
  await startCamera(page);
  await expect(page.locator('#notice')).toContainText('Package code and expiry found');
  await expect(page.getByLabel('Expiry date')).toHaveValue('2027-06-30');
  await expect(page.locator('#scanner-dialog')).not.toBeVisible();
  expect(await page.evaluate(() => window.testCameraTracks.every((track) => track.readyState === 'ended'))).toBe(true);
});

test('closing during camera permission and reopening does not stop the new camera', async ({ page }) => {
  await page.addInitScript(() => {
    window.testStreams = [];
    window.cameraCalls = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      window.cameraCalls++;
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const context = canvas.getContext('2d');
      const stream = canvas.captureStream(10);
      window.testStreams.push(stream);
      const draw = () => {
        context.fillStyle = 'white';
        context.fillRect(0, 0, 640, 480);
        if (stream.getTracks().some((track) => track.readyState === 'live')) requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
      if (window.cameraCalls === 1) return new Promise((resolve) => { window.resolveFirstCamera = () => resolve(stream); });
      return stream;
    };
  });
  await page.goto('/');
  await startCamera(page);
  await expect.poll(() => page.evaluate(() => window.cameraCalls)).toBe(1);
  await page.getByRole('button', { name: 'Close scanner' }).click();
  await startCamera(page);
  await expect(page.locator('#scan-status')).toContainText('Camera ready');
  await page.evaluate(() => window.resolveFirstCamera());
  await expect.poll(() => page.evaluate(() => window.testStreams[0].getTracks()[0].readyState)).toBe('ended');
  expect(await page.evaluate(() => window.testStreams[1].getTracks()[0].readyState)).toBe('live');
  await page.getByRole('button', { name: 'Close scanner' }).click();
  expect(await page.evaluate(() => window.testStreams[1].getTracks()[0].readyState)).toBe('ended');
});

test('a new medicine is shown even when the previous filter and search would hide it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Expired', exact: true }).click();
  await page.getByRole('searchbox').fill('something else');
  await addMedicine(page);
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'All medicines', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.medicine-card')).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Allergy tablets', exact: true })).toBeVisible();
});

test('closing a phone edit protects changes and a dock scan creates a separate medicine', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  });
  await page.goto('/');
  await addMedicine(page);
  await page.getByRole('button', { name: 'Edit Allergy tablets', exact: true }).click();
  await page.getByLabel('Medicine name').fill('Unsaved edit');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('#close-editor').click();
  await expect(page.locator('#mobile-editor')).toBeVisible();
  await expect(page.getByLabel('Medicine name')).toHaveValue('Unsaved edit');
  page.once('dialog', (dialog) => dialog.accept());
  await page.keyboard.press('Escape');
  await expect(page.locator('#mobile-editor')).not.toBeVisible();
  await page.locator('#mobile-scan').click();
  await expect(page.locator('#scan-status')).toContainText('Camera permission was denied');
  await page.locator('#manual-entry').click();
  await expect(page.getByLabel('Medicine name')).toHaveValue('');
  await expect(page.getByLabel('Expiry date')).toHaveValue('');
  await page.getByLabel('Medicine name').fill('A different package');
  await page.getByLabel('Expiry date').fill('2090-02-15');
  await page.getByRole('button', { name: 'Save to my cabinet' }).click();
  await expect(page.locator('#stat-total')).toHaveText('2');
  await expect(page.getByRole('heading', { name: 'Allergy tablets', exact: true })).toBeVisible();
});

test('switching cabinet entries cannot silently overwrite a changed desktop form', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await page.goto('/');
  await addMedicine(page);
  await addMedicine(page, 'Travel tablets');
  await page.getByRole('button', { name: 'Edit Allergy tablets', exact: true }).click();
  await page.getByLabel('Medicine name').fill('My unsaved draft');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Edit Travel tablets', exact: true }).click();
  await expect(page.getByLabel('Medicine name')).toHaveValue('My unsaved draft');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Edit Travel tablets', exact: true }).click();
  await expect(page.getByLabel('Medicine name')).toHaveValue('Travel tablets');
});
