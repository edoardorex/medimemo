export const STORAGE_KEY = 'medimemo.v1';
export const REMINDER_DAYS = [7, 14, 30, 60];
const DAY = 86_400_000;

export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(value, count) {
  if (!isValidDate(value) || !Number.isInteger(count)) throw new Error('Invalid date or day offset.');
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function daysUntil(expiry, today = todayISO()) {
  if (!isValidDate(expiry) || !isValidDate(today)) throw new Error('Invalid expiry date.');
  return Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
}

export function expiryStatus(expiry, today = todayISO()) {
  const days = daysUntil(expiry, today);
  return { days, kind: days < 0 ? 'expired' : days <= 30 ? 'soon' : 'safe' };
}

export function formatDate(value) {
  if (!isValidDate(value)) throw new Error('Invalid date.');
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`));
}

export function validateMedicine(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid medicine record.');
  if (typeof value.id !== 'string' || !value.id || value.id.length > 100) throw new Error('Invalid medicine identifier.');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw new Error('Enter a medicine name (up to 100 characters).');
  if (!isValidDate(value.expiry) || value.expiry < '2000-01-01' || value.expiry > '2099-12-31') throw new Error('Enter a valid expiry date between 2000 and 2099.');
  if (!REMINDER_DAYS.includes(value.reminderDays)) throw new Error('Choose a supported reminder interval.');
  if (typeof value.notes !== 'string' || value.notes.length > 500) throw new Error('Notes must be 500 characters or fewer.');
  if (typeof value.barcode !== 'string' || value.barcode.length > 300) throw new Error('Invalid package code.');
  return {
    id: value.id,
    name: value.name.trim(),
    expiry: value.expiry,
    reminderDays: value.reminderDays,
    notes: value.notes.trim(),
    barcode: value.barcode,
  };
}

export function validateBackup(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.medicines) || value.medicines.length > 1000) {
    throw new Error('This is not a supported MediMemo backup (maximum 1,000 medicines).');
  }
  const medicines = value.medicines.map(validateMedicine);
  if (new Set(medicines.map((medicine) => medicine.id)).size !== medicines.length) {
    throw new Error('The backup contains duplicate medicine identifiers.');
  }
  return medicines;
}

export function reminderDate(medicine, today = todayISO()) {
  if (!isValidDate(today)) throw new Error('Invalid current date.');
  const target = addDays(medicine.expiry, -medicine.reminderDays);
  return target < today ? today : target;
}

export function calendarURL(medicine, today = todayISO()) {
  const checked = validateMedicine(medicine);
  if (daysUntil(checked.expiry, today) < 0) throw new Error('This medicine has already expired.');
  const date = reminderDate(checked, today);
  const details = [
    `${checked.name} expires on ${checked.expiry}.`,
    'Check the date printed on the package and review your medicine cabinet.',
    checked.notes,
    'Created with MediMemo. Calendar notifications follow your Google Calendar settings.',
  ].filter(Boolean).join('\n\n');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Medicine expiry: ${checked.name}`,
    dates: `${date.replaceAll('-', '')}/${addDays(date, 1).replaceAll('-', '')}`,
    details,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function gs1Expiry(raw) {
  if (!/^\d{6}$/.test(raw)) return '';
  const year = 2000 + Number(raw.slice(0, 2));
  const month = Number(raw.slice(2, 4));
  let day = Number(raw.slice(4, 6));
  if (month < 1 || month > 12) return '';
  if (day === 0) day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidDate(date) ? date : '';
}

export function parsePackageCode(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 300) throw new Error('Unreadable or unsupported package code.');
  const code = text.trim();
  const withoutPrefix = code.replace(/^\][A-Za-z]\d/, '');
  const normalized = withoutPrefix.startsWith('\x1d') ? withoutPrefix.slice(1) : withoutPrefix;
  if (normalized.includes('(')) {
    const match = normalized.split('\x1d').map((part) => part.match(/\(17\)(\d{6})(?=\(|$)/)).find(Boolean);
    return { barcode: code, expiry: match ? gs1Expiry(match[1]) : '' };
  }
  if (!/^\](?:d2|C1|Q3)/.test(code) && !/^(?:00|01|02)\d{14}/.test(normalized)) {
    return { barcode: code, expiry: '' };
  }
  let position = 0;
  let expiry = '';
  const fixed = { '00': 18, '01': 14, '02': 14, '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6, '20': 2 };
  while (position < normalized.length) {
    if (normalized[position] === '\x1d') {
      position++;
      continue;
    }
    const ai = normalized.slice(position, position + 2);
    position += 2;
    if (Object.hasOwn(fixed, ai)) {
      const field = normalized.slice(position, position + fixed[ai]);
      if (!new RegExp(`^\\d{${fixed[ai]}}$`).test(field)) break;
      if (ai === '17') expiry = gs1Expiry(field);
      position += fixed[ai];
    } else if (ai === '10' || ai === '21') {
      const end = normalized.indexOf('\x1d', position);
      if (end === -1) break;
      position = end + 1;
    } else {
      break;
    }
  }
  return { barcode: code, expiry };
}

export function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}
