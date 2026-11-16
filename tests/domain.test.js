import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, calendarURL, daysUntil, escapeHTML, expiryStatus, isValidDate,
  parsePackageCode, reminderDate, todayISO, validateBackup, validateMedicine,
} from '../src/domain.js';
import { loadMedicines, saveMedicines } from '../src/storage.js';

const medicine = {
  id: 'test-1', name: 'Allergy tablets', expiry: '2027-01-15',
  reminderDays: 30, notes: 'Top shelf', barcode: '',
};

test('dates are validated without rollover and stay stable across daylight-saving boundaries', () => {
  assert.equal(isValidDate('2028-02-29'), true);
  for (const date of ['2027-02-29', '2027-04-31', '2027-13-01', 'bad', '2027-2-01', null]) assert.equal(isValidDate(date), false);
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(daysUntil('2027-03-29', '2027-03-27'), 2);
  assert.equal(todayISO(new Date(2027, 0, 2, 0, 1)), '2027-01-02');
});

test('expiry status includes today and the full 30-day warning window', () => {
  assert.deepEqual(expiryStatus('2027-01-01', '2027-01-02'), { days: -1, kind: 'expired' });
  assert.deepEqual(expiryStatus('2027-01-02', '2027-01-02'), { days: 0, kind: 'soon' });
  assert.equal(expiryStatus('2027-02-01', '2027-01-02').kind, 'soon');
  assert.equal(expiryStatus('2027-02-02', '2027-01-02').kind, 'safe');
});

test('Calendar creates an all-day event before expiry, clamps past reminders to today and rejects expired items', () => {
  const url = new URL(calendarURL({ ...medicine, name: 'A&B + tablets', notes: 'Keep <closed>' }, '2026-11-16'));
  assert.equal(url.origin, 'https://calendar.google.com');
  assert.equal(url.searchParams.get('text'), 'Medicine expiry: A&B + tablets');
  assert.equal(url.searchParams.get('dates'), '20261216/20261217');
  assert.match(url.searchParams.get('details'), /Keep <closed>/);
  assert.equal(reminderDate(medicine, '2027-01-14'), '2027-01-14');
  assert.equal(new URL(calendarURL(medicine, '2027-01-15')).searchParams.get('dates'), '20270115/20270116');
  assert.throws(() => calendarURL(medicine, '2027-01-16'), /already expired/);
});

test('GS1 expiry decoding handles standard fields, FNC1 separators and day 00', () => {
  assert.equal(parsePackageCode(']d201095060001343521727013110LOT42').expiry, '2027-01-31');
  assert.equal(parsePackageCode('010950600013435210LOT42\x1d17280200').expiry, '2028-02-29');
  assert.equal(parsePackageCode('(01)09506000134352(17)270600(10)LOT42').expiry, '2027-06-30');
  assert.equal(parsePackageCode(']C1010950600013435217271231').expiry, '2027-12-31');
});

test('retail codes, lot numbers, unknown fields and impossible GS1 dates do not invent expiry dates', () => {
  for (const code of ['8001234567890', '1727013199999', '010950600013435210LOT17270131', '(17)270231', '(17)271300', '1727013199', 'https://example.org/17270131']) {
    assert.equal(parsePackageCode(code).expiry, '', code);
  }
  assert.throws(() => parsePackageCode(''), /Unreadable/);
  assert.throws(() => parsePackageCode('x'.repeat(301)), /unsupported/);
});

test('backup validation rejects malformed, oversized and duplicate records', () => {
  assert.deepEqual(validateBackup({ version: 1, medicines: [medicine] }), [medicine]);
  assert.throws(() => validateBackup({ version: 2, medicines: [] }), /supported/);
  assert.throws(() => validateBackup({ version: 1, medicines: [medicine, medicine] }), /duplicate/);
  assert.throws(() => validateMedicine({ ...medicine, reminderDays: -5 }), /interval/);
  assert.throws(() => validateMedicine({ ...medicine, expiry: '2027-02-30' }), /date/);
  assert.throws(() => validateMedicine({ ...medicine, name: ' ' }), /name/);
  assert.equal(escapeHTML('<img src="x">&\''), '&lt;img src=&quot;x&quot;&gt;&amp;&#39;');
});

test('storage round-trips data and surfaces corruption and write failures', () => {
  let raw = null;
  const storage = { getItem: () => raw, setItem: (_key, value) => { raw = value; } };
  assert.deepEqual(loadMedicines(storage), []);
  saveMedicines([medicine], storage);
  assert.deepEqual(loadMedicines(storage), [medicine]);
  raw = '{broken';
  assert.throws(() => loadMedicines(storage), SyntaxError);
  assert.throws(() => saveMedicines([medicine], { setItem: () => { throw new Error('Quota exceeded'); } }), /Quota exceeded/);
});
