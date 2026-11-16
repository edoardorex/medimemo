import './style.css';
import {
  calendarURL, escapeHTML as h, expiryStatus, formatDate,
  parsePackageCode, reminderDate, todayISO, validateBackup, validateMedicine,
} from './domain.js';
import { loadMedicines, saveMedicines } from './storage.js';
import { cameraError, createScanner, stopVideo } from './scanner.js';

const pill = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M8.5 3.5a5 5 0 0 1 7 7l-5 5a5 5 0 0 1-7-7z" transform="translate(2 2)"/><path d="m8.5 8.5 7 7"/></svg>';
const calendar = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 5 3 3 5-5"/></svg>';
const scan = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M8 3H4a1 1 0 0 0-1 1v4m13-5h4a1 1 0 0 1 1 1v4M3 16v4a1 1 0 0 0 1 1h4m8 0h4a1 1 0 0 0 1-1v-4M7 7v10m3-10v10m4-10v10m3-10v10"/></svg>';
let medicines = [];
let storageBlocked = false;
let activeId = '';
let controls;
let cameraSession = 0;
let scanLocked = false;
let midnightTimer;
let noticeTimer;

document.querySelector('#app').innerHTML = `
  <header class="topbar">
    <a class="brand" href="./" aria-label="MediMemo home"><span class="brand-mark">${pill}</span>MediMemo<span class="brand-dot">.</span></a>
    <span class="privacy-chip"><span></span> Local-first. Just for you.</span>
  </header>
  <a class="skip-link" href="#cabinet-title">Skip to your cabinet</a>
  <main>
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <p class="eyebrow">SMALL REMINDERS. BIG PEACE OF MIND.</p>
        <h1 id="hero-title">A happier<br /><span>medicine cabinet.</span></h1>
        <p>Keep an eye on expiry dates, scan a package, and give your future self a little heads-up.</p>
        <button class="button primary" id="hero-add" type="button">+ Add a medicine</button>
        <span class="hero-note">No account. No fuss. No forgotten boxes.</span>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="art-orbit"></div>
        <div class="art-card"><span class="art-icon">${calendar}</span><span>A little heads-up</span><strong>Future you says thanks.</strong><div class="art-line"></div><div class="art-line short"></div><span class="art-check">All set!</span></div>
        <div class="art-pill"></div><div class="art-spark">+</div><div class="art-dot"></div>
      </div>
    </section>
    <section class="stats" aria-label="Cabinet overview">
      <div><span class="stat-icon mint">${pill}</span><span><strong id="stat-total">0</strong><span>In your cabinet</span></span></div>
      <div><span class="stat-icon amber">${calendar}</span><span><strong id="stat-soon">0</strong><span>Due within 30 days</span></span></div>
      <div><span class="stat-icon rose">!</span><span><strong id="stat-expired">0</strong><span>Already expired</span></span></div>
    </section>
    <section class="storage-error" id="storage-error" role="alert" hidden>
      <p id="storage-message"></p><button class="button secondary" id="reset-storage" type="button">Reset local data</button>
    </section>
    <div class="workspace">
      <section class="cabinet" aria-labelledby="cabinet-title">
        <div class="section-heading"><div><p class="eyebrow">YOUR LITTLE COLLECTION</p><h2 id="cabinet-title" tabindex="-1">The cabinet</h2></div><div class="backup-actions"><button type="button" class="text-button" id="export">Export</button><button type="button" class="text-button" id="import">Import</button></div></div>
        <label class="search"><span aria-hidden="true">&#8981;</span><input type="search" id="search" placeholder="Find a medicine..." aria-label="Search medicines" maxlength="100" /></label>
        <div class="filters" role="group" aria-label="Filter by expiry status">
          <button type="button" data-filter="all" aria-pressed="true">All medicines</button>
          <button type="button" data-filter="soon" aria-pressed="false">Expiring soon</button>
          <button type="button" data-filter="expired" aria-pressed="false">Expired</button>
        </div>
        <div id="medicine-list" class="medicine-list"></div>
      </section>
      <aside class="editor-panel" aria-labelledby="form-title">
        <div class="section-heading"><div><p class="eyebrow">MAKE ROOM FOR PEACE OF MIND</p><h2 id="form-title">Add a medicine</h2></div><span class="mini-pill">${pill}</span></div>
        <button type="button" class="scan-button" id="open-scanner">${scan}<span>Scan with your camera<small>Package barcode or Data Matrix</small></span><span aria-hidden="true">&rarr;</span></button>
        <div class="divider"><span>or enter the details</span></div>
        <form id="medicine-form">
          <label for="name">Medicine name</label><input id="name" name="name" placeholder="e.g. Allergy tablets" required maxlength="100" autocomplete="off" />
          <div class="form-row"><div><label for="expiry">Expiry date</label><input id="expiry" name="expiry" type="date" required min="2000-01-01" max="2099-12-31" /></div><div><label for="reminder">Remind me</label><select id="reminder" name="reminder"><option value="7">7 days before</option><option value="14">14 days before</option><option value="30" selected>30 days before</option><option value="60">60 days before</option></select></div></div>
          <label for="notes">Notes <span class="optional">optional</span></label><textarea id="notes" name="notes" placeholder="Shelf, package size, or anything useful" maxlength="500" rows="2"></textarea>
          <div id="code-summary" class="code-summary" hidden></div><input type="hidden" id="barcode" name="barcode" />
          <p class="field-help">Check the date on the package. For month/year labels, select the last day of that month only if the package instructions say so.</p>
          <button class="button primary full-width" id="save" type="submit">+ Save to my cabinet</button>
          <button class="text-button full-width" id="cancel-edit" type="button" hidden>Cancel editing</button>
        </form>
        <div class="calendar-note">${calendar}<p><strong>A nudge for future you.</strong> After saving, choose Google Calendar on a medicine card and confirm the event. Notifications use your Calendar settings.</p></div>
      </aside>
    </div>
    <footer><span>Made for a little less &ldquo;oh, I forgot.&rdquo;</span><span>Stored on this browser &middot; Not medical advice</span></footer>
  </main>
  <dialog id="scanner-dialog" aria-labelledby="scanner-title">
    <div class="section-heading"><h2 id="scanner-title">Let's scan that package</h2><button class="close-button" id="close-scanner" aria-label="Close scanner" type="button">&times;</button></div>
    <p>Point your camera at a barcode or Data Matrix in good light. Keep the entire code in view.</p>
    <div class="video-frame"><video id="camera" autoplay muted playsinline></video><div class="scan-guide" aria-hidden="true"></div></div>
    <p id="scan-status" role="status">Starting your camera...</p>
    <p class="field-help">Video stays on your device. Standard retail barcodes identify the package, not its expiry. Only a GS1 expiry field can fill the date; always verify it.</p>
    <button class="button secondary full-width" id="manual-entry" type="button">Use manual entry instead</button>
  </dialog>
  <input id="import-file" type="file" accept=".json,application/json" hidden />
  <div id="notice" class="notice" role="status" aria-live="polite" hidden></div>
`;

const form = document.querySelector('#medicine-form');
const dialog = document.querySelector('#scanner-dialog');
let video = document.querySelector('#camera');
let filter = 'all';

function notify(message, error = false) {
  clearTimeout(noticeTimer);
  const notice = document.querySelector('#notice');
  notice.textContent = message;
  notice.classList.toggle('error', error);
  notice.hidden = false;
  noticeTimer = setTimeout(() => { notice.hidden = true; }, error ? 12_000 : 6000);
}

function persistenceError(message) {
  storageBlocked = true;
  document.querySelector('#storage-message').textContent = message;
  document.querySelector('#storage-error').hidden = false;
  form.querySelectorAll('input, select, textarea, button').forEach((element) => { element.disabled = true; });
}

try {
  medicines = loadMedicines();
} catch (error) {
  persistenceError(`Local data could not be read: ${error.message}. Changes are blocked to protect your data. Restore from a backup using Import, or explicitly reset local data.`);
}

function commit(next) {
  try {
    saveMedicines(next);
    medicines = next;
    storageBlocked = false;
    document.querySelector('#storage-error').hidden = true;
    form.querySelectorAll('input, select, textarea, button').forEach((element) => { element.disabled = false; });
    render();
    return true;
  } catch (error) {
    notify(`Could not save: ${error.message}. Your change was not saved. Check browser storage permissions or available space.`, true);
    return false;
  }
}

function statusLabel({ days, kind }) {
  if (kind === 'expired') return `Expired ${Math.abs(days)} ${days === -1 ? 'day' : 'days'} ago`;
  if (days === 0) return 'Expires today';
  return `${days} ${days === 1 ? 'day' : 'days'} left`;
}

function render() {
  const today = todayISO();
  document.body.classList.toggle('has-medicines', medicines.length > 0);
  const statuses = medicines.map((medicine) => expiryStatus(medicine.expiry, today));
  document.querySelector('#stat-total').textContent = medicines.length;
  document.querySelector('#stat-soon').textContent = statuses.filter((status) => status.kind === 'soon').length;
  document.querySelector('#stat-expired').textContent = statuses.filter((status) => status.kind === 'expired').length;
  const query = document.querySelector('#search').value.trim().toLocaleLowerCase();
  const visible = medicines
    .filter((medicine) => (filter === 'all' || expiryStatus(medicine.expiry, today).kind === filter) && `${medicine.name} ${medicine.notes}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => a.expiry.localeCompare(b.expiry) || a.name.localeCompare(b.name));
  document.querySelector('#medicine-list').innerHTML = visible.length ? visible.map((medicine) => {
    const status = expiryStatus(medicine.expiry, today);
    const reminder = status.kind !== 'expired' ? reminderDate(medicine, today) : '';
    return `<article class="medicine-card ${status.kind}" data-medicine-id="${h(medicine.id)}" tabindex="-1">
      <div class="medicine-top"><span class="medicine-icon">${pill}</span><div><h3>${h(medicine.name)}</h3><p>Expires ${h(formatDate(medicine.expiry))}</p></div><span class="status-badge ${status.kind}">${h(statusLabel(status))}</span></div>
      ${medicine.notes ? `<p class="medicine-notes">${h(medicine.notes)}</p>` : ''}
      <div class="card-bottom"><span class="reminder-label">${reminder ? `Calendar event: ${h(formatDate(reminder))}` : 'Review this package before use'}</span><div class="card-actions">
        ${reminder ? `<a class="calendar-link" href="${h(calendarURL(medicine, today))}" target="_blank" rel="noopener noreferrer" aria-label="Add Google Calendar reminder for ${h(medicine.name)}">${calendar}<span>Google Calendar</span><span aria-hidden="true">&#8599;</span></a>` : ''}
        <button class="text-button" data-edit="${h(medicine.id)}" type="button" aria-label="Edit ${h(medicine.name)}">Edit</button>
        <button class="text-button danger" data-delete="${h(medicine.id)}" type="button" aria-label="Delete ${h(medicine.name)}">Delete</button>
      </div></div></article>`;
  }).join('') : `<div class="empty-state"><span class="empty-icon">${pill}</span><h3>${medicines.length ? 'No matches just yet.' : 'A fresh start for your cabinet.'}</h3><p>${medicines.length ? 'Try another search or filter.' : 'Add your first medicine on the right.<br />Future you will appreciate it.'}</p></div>`;
  document.querySelector('#export').disabled = !medicines.length || storageBlocked;
}

function setCode(barcode) {
  form.elements.barcode.value = barcode;
  const summary = document.querySelector('#code-summary');
  summary.textContent = barcode ? `Package code: ${barcode.replaceAll('\x1d', ' | ')}` : '';
  summary.hidden = !barcode;
}

function resetForm() {
  activeId = '';
  form.reset();
  setCode('');
  document.querySelector('#form-title').textContent = 'Add a medicine';
  document.querySelector('#save').textContent = '+ Save to my cabinet';
  document.querySelector('#cancel-edit').hidden = true;
}

function focusEditor() {
  document.querySelector('.editor-panel').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  form.elements.name.focus({ preventScroll: true });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (storageBlocked) return;
  try {
    const wasEditing = Boolean(activeId);
    const medicine = validateMedicine({
      id: activeId || crypto.randomUUID(),
      name: form.elements.name.value,
      expiry: form.elements.expiry.value,
      reminderDays: Number(form.elements.reminder.value),
      notes: form.elements.notes.value,
      barcode: form.elements.barcode.value,
    });
    const next = activeId ? medicines.map((item) => item.id === activeId ? medicine : item) : [...medicines, medicine];
    if (next.length > 1000) throw new Error('Your cabinet is full (1,000 medicines). Export a backup before removing old entries.');
    if (commit(next)) {
      resetForm();
      filter = 'all';
      document.querySelector('#search').value = '';
      document.querySelectorAll('[data-filter]').forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.filter === 'all')));
      render();
      const card = [...document.querySelectorAll('[data-medicine-id]')].find((item) => item.dataset.medicineId === medicine.id);
      card.focus({ preventScroll: true });
      card.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
      notify(wasEditing ? 'Updated locally. Existing Calendar events are unchanged; edit them in Google Calendar.' : 'Saved! Choose Google Calendar on the card to create your reminder.');
    }
  } catch (error) {
    notify(error.message, true);
  }
});

document.querySelector('#hero-add').addEventListener('click', () => { resetForm(); focusEditor(); });
document.querySelector('#cancel-edit').addEventListener('click', resetForm);
document.querySelector('#search').addEventListener('input', render);
document.querySelector('.filters').addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  render();
});

document.querySelector('#medicine-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-edit], [data-delete]');
  if (!button || storageBlocked) return;
  const medicine = medicines.find((item) => item.id === (button.dataset.edit || button.dataset.delete));
  if (!medicine) return;
  if (button.dataset.delete) {
    if (confirm(`Remove "${medicine.name}" from this browser? Existing Google Calendar events will not be deleted.`) && commit(medicines.filter((item) => item.id !== medicine.id))) {
      if (activeId === medicine.id) resetForm();
      notify('Medicine removed. Any existing Google Calendar event is unchanged.');
    }
  } else {
    activeId = medicine.id;
    form.elements.name.value = medicine.name;
    form.elements.expiry.value = medicine.expiry;
    form.elements.reminder.value = medicine.reminderDays;
    form.elements.notes.value = medicine.notes;
    setCode(medicine.barcode);
    document.querySelector('#form-title').textContent = 'Edit medicine';
    document.querySelector('#save').textContent = 'Save changes';
    document.querySelector('#cancel-edit').hidden = false;
    focusEditor();
  }
});

document.querySelector('#export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, medicines }, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `medimemo-backup-${todayISO()}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('Backup downloaded. Keep it private: it contains your medicine names and notes.');
});
document.querySelector('#import').addEventListener('click', () => document.querySelector('#import-file').click());
document.querySelector('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('The backup is too large (maximum 2 MB).');
    const next = validateBackup(JSON.parse(await file.text()));
    if (!confirm(`Replace local data with ${next.length} medicine(s) from this backup? Existing Calendar events are unchanged.`)) return;
    if (commit(next)) { resetForm(); notify('Backup restored.'); }
  } catch (error) {
    notify(`Could not import: ${error.message}. Your existing data is unchanged.`, true);
  }
});
document.querySelector('#reset-storage').addEventListener('click', () => {
  if (confirm('Permanently replace the unreadable local data with an empty cabinet? This cannot be undone.')) {
    if (commit([])) { resetForm(); notify('Local data reset.'); }
  }
});

function stopCamera() {
  cameraSession++;
  controls?.stop();
  controls = undefined;
  stopVideo(video);
}

function closeScanner() {
  stopCamera();
  dialog.close();
}

document.querySelector('#open-scanner').addEventListener('click', async () => {
  if (storageBlocked) {
    notify('Restore or reset the unreadable local data before adding a medicine.', true);
    return;
  }
  dialog.showModal();
  const status = document.querySelector('#scan-status');
  status.textContent = 'Starting your camera...';
  scanLocked = false;
  const session = ++cameraSession;
  const sessionVideo = video.cloneNode();
  video.replaceWith(sessionVideo);
  video = sessionVideo;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    status.textContent = 'Camera scanning needs HTTPS or localhost and a supported browser. Manual entry always works.';
    return;
  }
  try {
    const reader = await createScanner();
    if (session !== cameraSession) return;
    const started = await reader.decodeFromConstraints({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    }, sessionVideo, (result, error, scanControls) => {
      if (session !== cameraSession || scanLocked) return;
      if (result) {
        try {
          const parsed = parsePackageCode(result.getText());
          scanLocked = true;
          scanControls.stop();
          setCode(parsed.barcode);
          if (parsed.expiry) form.elements.expiry.value = parsed.expiry;
          closeScanner();
          focusEditor();
          notify(parsed.expiry ? 'Package code and expiry found! Verify the printed date and enter the medicine name.' : 'Package code captured. Enter the name and expiry printed on the package.');
        } catch (parseError) {
          status.textContent = parseError.message;
        }
      } else if (error && !['NotFoundException', 'ChecksumException', 'FormatException'].includes(error.name)) {
        status.textContent = `Scan error: ${error.message}. Try repositioning the package or use manual entry.`;
      }
    });
    if (session !== cameraSession) {
      started.stop();
      stopVideo(sessionVideo);
      return;
    }
    controls = started;
    status.textContent = 'Camera ready. Hold the package steady inside the frame.';
  } catch (error) {
    if (session === cameraSession) {
      stopCamera();
      status.textContent = cameraError(error);
    }
  }
});
document.querySelector('#close-scanner').addEventListener('click', closeScanner);
document.querySelector('#manual-entry').addEventListener('click', () => { closeScanner(); focusEditor(); });
dialog.addEventListener('cancel', stopCamera);
dialog.addEventListener('close', stopCamera);
window.addEventListener('pagehide', stopCamera);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && dialog.open) closeScanner();
  if (!document.hidden) { render(); scheduleMidnight(); }
});

function scheduleMidnight() {
  clearTimeout(midnightTimer);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  midnightTimer = setTimeout(() => { render(); scheduleMidnight(); }, next - now + 100);
}

render();
scheduleMidnight();
