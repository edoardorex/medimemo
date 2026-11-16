import { STORAGE_KEY, validateBackup } from './domain.js';

export function loadMedicines(storage = localStorage) {
  const raw = storage.getItem(STORAGE_KEY);
  return raw === null ? [] : validateBackup(JSON.parse(raw));
}

export function saveMedicines(medicines, storage = localStorage) {
  const backup = { version: 1, medicines };
  validateBackup(backup);
  storage.setItem(STORAGE_KEY, JSON.stringify(backup));
}
