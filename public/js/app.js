import { api } from './api.js';
import * as vault from './crypto.js';
import { esc, fullName, fillTemplate, newId } from './util.js';
import { DEFAULT_SETTINGS, demoApplicants } from './defaults.js';
import { exportExcel } from './excel.js';

const MAX_FILES = 10;
const STATUS_HTML = {
    offen: '<span class="status status-open">🟢 Offen</span>',
    hingehalten: '<span class="status status-stalled">⏳ Hingehalten</span>',
    abgesagt: '<span class="status status-rejected">🔴 Abgesagt</span>'
};

const state = {
    key: null,         // AES-Schlüssel, existiert nur im Arbeitsspeicher
    vaultInfo: null,
    settings: null,
    applicants: [],    // entschlüsselte Bewerber
    currentId: null,   // in der Detailansicht geöffneter Bewerber
    aiReady: false
};

const $ = (id) => document.getElementById(id);
const findApplicant = (id) => state.applicants.find(a => a.id === id);

// ---------------------------------------------------------------------------
// Tresor
// ---------------------------------------------------------------------------

async function initLogin() {
    if (!vault.isSupported()) {
        $('loginHint').textContent = 'Ihr Browser unterstützt die Web Crypto API nicht. Bitte die App über http://localhost öffnen.';
        $('loginButton').disabled = true;
        return;
    }
    try {
        state.vaultInfo = await api.getVault();
    } catch (error) {
        $('loginHint').textContent = error.message;
        return;
    }

    if (state.vaultInfo.initialized) {
        $('loginHint').innerHTML = 'Geben Sie das Master-Passwort ein.<br><small>Es wird nirgends gespeichert.</small>';
    } else {
        $('loginHint').innerHTML = 'Willkommen! Legen Sie ein Master-Passwort fest (mind. 8 Zeichen).<br>' +
            '<small><strong>Wichtig:</strong> Ohne dieses Passwort lassen sich die Daten nicht wiederherstellen.</small>';
        $('confirmContainer').classList.remove('hidden');
        $('masterPassword').autocomplete = 'new-password';
        $('loginButton').textContent = 'Tresor einrichten';
    }
    $('masterPassword').focus();
}

async function unlock(event) {
    event.preventDefault();
    const password = $('masterPassword').value;
    const button = $('loginButton');
    const label = button.textContent;
    $('loginError').textContent = '';

    if (!state.vaultInfo.initialized) {
        if (password.length < 8) return void ($('loginError').textContent = 'Das Passwort muss mindestens 8 Zeichen lang sein.');
        if (password !== $('confirmPassword').value) return void ($('loginError').textContent = 'Die Passwörter stimmen nicht überein.');
    }

    button.disabled = true;
    button.textContent = 'Schlüssel wird berechnet …';
    try {
        if (state.vaultInfo.initialized) {
            const { salt, iterations, check } = state.vaultInfo;
            const key = await vault.deriveKey(password, salt, iterations);
            if (!(await vault.verifyCheck(key, check))) {
                $('loginError').textContent = 'Falsches Master-Passwort.';
                $('masterPassword').select();
                return;
            }
            state.key = key;
        } else {
            const salt = vault.createSalt();
            const iterations = vault.DEFAULT_ITERATIONS;
            const key = await vault.deriveKey(password, salt, iterations);
            await api.createVault({ salt, iterations, check: await vault.createCheck(key) });
            state.key = key;
        }

        await loadSettings();
        await loadApplicants();
        $('loginOverlay').classList.add('hidden');
        $('app').classList.remove('blurred');
        $('masterPassword').value = '';
        $('confirmPassword').value = '';
        checkAiStatus();
    } catch (error) {
        $('loginError').textContent = error.message;
    } finally {
        button.disabled = false;
        button.textContent = label;
    }
}

function lock() {
    state.key = null;
    location.reload();
}

// ---------------------------------------------------------------------------
// Daten laden und speichern
// ---------------------------------------------------------------------------

async function loadSettings() {
    const { data } = await api.getSettings();
    if (data) {
        state.settings = { ...DEFAULT_SETTINGS, ...(await vault.decrypt(state.key, data)) };
    } else {
        state.settings = structuredClone(DEFAULT_SETTINGS);
        await api.saveSettings(await vault.encrypt(state.key, state.settings));
    }
    renderSettingsForm();
}

async function decryptApplicant(row) {
    try {
        return { ...row, ...(await vault.decrypt(state.key, row.data)), locked: false };
    } catch {
        return { ...row, locked: true };
    }
}

async function loadApplicants() {
    const rows = await api.listApplicants();
    state.applicants = await Promise.all(rows.map(decryptApplicant));
    renderAll();
}

// Nur diese Felder werden verschlüsselt gespeichert.
function personalData(applicant) {
    const { firstName, lastName, birthDate, email, phone, address, experience, reviews } = applicant;
    return { firstName, lastName, birthDate, email, phone, address, experience, reviews: reviews || {} };
}

async function createApplicant(data, status = 'offen') {
    const row = await api.createApplicant({ data: await vault.encrypt(state.key, personalData(data)), status });
    const applicant = await decryptApplicant(row);
    state.applicants.push(applicant);
    return applicant;
}

async function updateApplicant(id, changes) {
    const row = await api.updateApplicant(id, changes);
    const index = state.applicants.findIndex(a => a.id === id);
    state.applicants[index] = await decryptApplicant(row);
    return state.applicants[index];
}

// ---------------------------------------------------------------------------
// Darstellung
// ---------------------------------------------------------------------------

function searchTerm(list) {
    return document.querySelector(`.search-input[data-list="${list}"]`).value.trim().toLowerCase();
}

function matchesSearch(applicant, term) {
    return fullName(applicant).toLowerCase().includes(term);
}

function isIncomplete(applicant) {
    return state.settings.team.some(member => !applicant.reviews?.[member.id]?.rating);
}

function ratingsHtml(applicant) {
    return `<div class="ratings-stack">${state.settings.team.map(member => {
        const rating = applicant.reviews?.[member.id]?.rating || '';
        return `<div class="rating-mini ${rating || 'none'}" title="${esc(member.name)}">${esc(member.name.charAt(0).toUpperCase())}: ${rating || '–'}</div>`;
    }).join('')}</div>`;
}

function nameCell(applicant) {
    return applicant.locked ? '<em>🔒 Nicht entschlüsselbar</em>' : `<strong>${esc(fullName(applicant))}</strong>`;
}

const byNewest = (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id;

function renderOverview() {
    const term = searchTerm('overview');
    const status = $('statusFilter').value;
    const sort = $('sortSelect').value;

    let list = state.applicants.filter(a => matchesSearch(a, term) && (!status || a.status === status));
    if (sort === 'incomplete') list = list.filter(isIncomplete);

    const sorters = {
        newest: byNewest,
        incomplete: byNewest,
        oldest: (a, b) => -byNewest(a, b),
        asc: (a, b) => fullName(a).localeCompare(fullName(b), 'de'),
        desc: (a, b) => fullName(b).localeCompare(fullName(a), 'de')
    };
    list.sort(sorters[sort]);

    $('candidateCounter').textContent = `${list.length} Bewerber`;
    $('emptyState').classList.toggle('hidden', state.applicants.length > 0);
    $('overviewBody').innerHTML = list.map(a => `
        <tr class="clickable-row" data-action="open" data-id="${a.id}">
            <td class="checkbox-cell"><input type="checkbox" data-action="toggle-read" data-id="${a.id}" ${a.isRead ? 'checked' : ''} aria-label="Gelesen"></td>
            <td>${STATUS_HTML[a.status]}</td>
            <td>${ratingsHtml(a)}</td>
            <td>${esc(a.birthDate) || '—'}</td>
            <td>${nameCell(a)}</td>
            <td>${esc(a.email) || '—'}</td>
            <td class="action-cell"><button type="button" class="btn-delete-icon" data-action="delete" data-id="${a.id}" title="Löschen">🗑️</button></td>
        </tr>`).join('');
}

// Gemeinsame Darstellung der Seiten „Hinhalten“ und „Absagen“.
function renderMailList(type) {
    const config = {
        stall: { body: 'stallBody', doneStatus: 'hingehalten', button: '⏳ Mail senden', buttonClass: 'btn-stall' },
        reject: { body: 'rejectBody', doneStatus: 'abgesagt', button: '✉️ Absagen', buttonClass: 'btn-reject' }
    }[type];

    const term = searchTerm(type);
    const list = state.applicants
        .filter(a => matchesSearch(a, term) && (type === 'reject' || a.status !== 'abgesagt'))
        .sort((a, b) => (a.status === config.doneStatus) - (b.status === config.doneStatus) || byNewest(a, b));

    $(config.body).innerHTML = list.map(a => {
        const done = a.status === config.doneStatus;
        return `
        <tr class="${done ? 'is-done' : ''}">
            <td class="checkbox-cell"><input type="checkbox" ${a.isRead ? 'checked' : ''} disabled aria-label="Gelesen"></td>
            <td>${STATUS_HTML[a.status]}</td>
            <td>${ratingsHtml(a)}</td>
            <td>${nameCell(a)}</td>
            <td>${esc(a.email) || '—'}</td>
            <td>${done
                ? '<span class="hint">Erledigt</span>'
                : `<button type="button" class="${config.buttonClass}" data-action="mail-${type}" data-id="${a.id}">${config.button}</button>`}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="6" class="hint">Keine Bewerber.</td></tr>';
}

function renderAll() {
    renderOverview();
    renderMailList('stall');
    renderMailList('reject');
}

function showView(id) {
    const a = findApplicant(id);
    if (!a || a.locked) return alert('Dieser Eintrag kann nicht entschlüsselt werden.');
    state.currentId = id;

    $('editSection').classList.add('hidden');
    $('viewName').textContent = fullName(a);
    $('viewStatus').innerHTML = STATUS_HTML[a.status];
    $('viewBirthDate').textContent = a.birthDate || '—';
    $('viewEmail').textContent = a.email || '—';
    $('viewPhone').textContent = a.phone || '—';
    $('viewAddress').textContent = a.address || '—';
    $('viewExperience').textContent = a.experience || 'Keine Angaben';
    $('viewReviews').innerHTML = state.settings.team.map(member => {
        const review = a.reviews?.[member.id] || {};
        return `
        <div class="comment-box">
            <strong>${esc(member.name)} ${review.rating ? `<span class="rating-badge ${review.rating}">${review.rating}</span>` : ''}</strong>
            <div class="comment-text ${review.comment ? '' : 'empty'}">${esc(review.comment) || 'Noch kein Kommentar'}</div>
        </div>`;
    }).join('') || '<p class="hint">Unter „Einstellungen“ können Team-Mitglieder erfasst werden.</p>';

    $('viewSection').classList.remove('hidden');
    $('viewSection').scrollIntoView({ behavior: 'smooth' });
}

function showEditForm(applicant = {}) {
    state.currentId = applicant.id ?? null;
    $('viewSection').classList.add('hidden');
    $('formTitle').textContent = applicant.id ? 'Bewerber bearbeiten' : 'Neuen Bewerber erfassen';

    $('inFirstName').value = applicant.firstName || '';
    $('inLastName').value = applicant.lastName || '';
    $('inBirthDate').value = applicant.birthDate || '';
    $('inEmail').value = applicant.email || '';
    $('inPhone').value = applicant.phone || '';
    $('inAddress').value = applicant.address || '';
    $('inStatus').value = applicant.status || 'offen';
    $('inExperience').value = applicant.experience || '';

    $('editReviews').innerHTML = state.settings.team.map(member => {
        const review = applicant.reviews?.[member.id] || {};
        return `
        <div class="field" data-member="${esc(member.id)}">
            <label>${esc(member.name)}</label>
            <div class="comment-input-row">
                <select class="rating-select">
                    ${['', 'A', 'B', 'C'].map(r => `<option value="${r}" ${review.rating === r ? 'selected' : ''}>${r || 'Bewertung …'}</option>`).join('')}
                </select>
                <textarea rows="2" placeholder="Notizen von ${esc(member.name)} …">${esc(review.comment)}</textarea>
            </div>
        </div>`;
    }).join('');

    $('editSection').classList.remove('hidden');
    $('editSection').scrollIntoView({ behavior: 'smooth' });
    $('inFirstName').focus({ preventScroll: true });
}

async function saveEditForm(event) {
    event.preventDefault();
    const existing = state.currentId ? findApplicant(state.currentId) : null;

    // Bewertungen ehemaliger Team-Mitglieder bleiben erhalten.
    const reviews = { ...(existing?.reviews || {}) };
    for (const row of $('editReviews').querySelectorAll('[data-member]')) {
        reviews[row.dataset.member] = {
            rating: row.querySelector('select').value,
            comment: row.querySelector('textarea').value.trim()
        };
    }

    const data = {
        firstName: $('inFirstName').value.trim(),
        lastName: $('inLastName').value.trim(),
        birthDate: $('inBirthDate').value.trim(),
        email: $('inEmail').value.trim(),
        phone: $('inPhone').value.trim(),
        address: $('inAddress').value.trim(),
        experience: $('inExperience').value.trim(),
        reviews
    };
    const status = $('inStatus').value;

    try {
        const saved = existing
            ? await updateApplicant(existing.id, { data: await vault.encrypt(state.key, personalData(data)), status })
            : await createApplicant(data, status);
        renderAll();
        showView(saved.id);
    } catch (error) {
        alert(`Speichern fehlgeschlagen: ${error.message}`);
    }
}

// ---------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------

async function toggleRead(id, isRead) {
    try {
        await updateApplicant(id, { isRead });
        renderAll();
    } catch (error) {
        alert(error.message);
        renderAll();
    }
}

async function deleteApplicant(id) {
    const applicant = findApplicant(id);
    if (!confirm(`Möchten Sie „${fullName(applicant)}“ wirklich dauerhaft löschen?`)) return;
    try {
        await api.deleteApplicant(id);
        state.applicants = state.applicants.filter(a => a.id !== id);
        if (state.currentId === id) {
            $('viewSection').classList.add('hidden');
            $('editSection').classList.add('hidden');
            state.currentId = null;
        }
        renderAll();
    } catch (error) {
        alert(`Löschen fehlgeschlagen: ${error.message}`);
    }
}

// Öffnet die Vorlage im Mailprogramm und setzt danach den Status.
async function sendMail(id, type) {
    const applicant = findApplicant(id);
    if (!applicant?.email) {
        return alert('Für diesen Bewerber ist keine E-Mail-Adresse hinterlegt.');
    }

    const template = state.settings.templates[type];
    const values = { vorname: applicant.firstName || '', nachname: applicant.lastName || '', firma: state.settings.company };
    const subject = encodeURIComponent(fillTemplate(template.subject, values));
    const body = encodeURIComponent(fillTemplate(template.body, values));
    window.location.href = `mailto:${encodeURIComponent(applicant.email)}?subject=${subject}&body=${body}`;

    try {
        await updateApplicant(id, { status: type === 'reject' ? 'abgesagt' : 'hingehalten' });
        renderAll();
    } catch (error) {
        alert(`Status konnte nicht gespeichert werden: ${error.message}`);
    }
}

async function uploadResumes(files) {
    if (files.length === 0) return;
    if (files.length > MAX_FILES) return alert(`Bitte maximal ${MAX_FILES} PDFs auf einmal hochladen.`);

    const statusEl = $('uploadStatus');
    const errorsEl = $('uploadErrors');
    const button = $('uploadButton');
    errorsEl.innerHTML = '';
    statusEl.textContent = `⏳ ${files.length} PDF(s) werden von der lokalen KI analysiert … Das kann pro Datei einige Sekunden dauern.`;
    button.disabled = true;

    try {
        const results = await api.extract(files);
        let saved = 0;
        for (const result of results) {
            if (!result.ok) continue;
            await createApplicant({ ...result.data, reviews: {} });
            saved++;
        }
        renderAll();

        const failed = results.filter(r => !r.ok);
        statusEl.textContent = `${failed.length ? '⚠️' : '✅'} ${saved} von ${files.length} Lebensläufen verschlüsselt gespeichert.`;
        errorsEl.innerHTML = failed.map(r => `<li><strong>${esc(r.fileName)}:</strong> ${esc(r.error)}</li>`).join('');
    } catch (error) {
        statusEl.textContent = `❌ ${error.message}`;
    } finally {
        button.disabled = false;
    }
}

async function checkAiStatus() {
    const el = $('aiStatus');
    try {
        const status = await api.getAiStatus();
        state.aiReady = status.available && status.modelInstalled;
        if (state.aiReady) {
            el.textContent = `🤖 KI bereit (${status.model})`;
            el.title = 'Ollama läuft lokal, Lebensläufe verlassen diesen Computer nicht.';
        } else if (status.available) {
            el.textContent = '⚠️ KI-Modell fehlt';
            el.title = `Bitte im Terminal ausführen: ollama pull ${status.model}`;
        } else {
            el.textContent = '⚪ KI nicht verfügbar';
            el.title = 'Ollama läuft nicht. Manuelle Erfassung ist weiterhin möglich.';
        }
    } catch {
        state.aiReady = false;
        el.textContent = '⚪ KI nicht verfügbar';
    }
    el.className = `ai-status ${state.aiReady ? 'ready' : 'offline'}`;
}

async function loadDemoData() {
    const button = $('demoButton');
    button.disabled = true;
    try {
        for (const demo of demoApplicants(state.settings.team)) {
            const applicant = await createApplicant(demo.data, demo.status);
            if (demo.isRead) await updateApplicant(applicant.id, { isRead: true });
        }
        renderAll();
    } catch (error) {
        alert(error.message);
    } finally {
        button.disabled = false;
    }
}

async function handleExport() {
    const readable = state.applicants.filter(a => !a.locked).sort(byNewest);
    if (readable.length === 0) return alert('Keine Daten zum Exportieren vorhanden.');
    const button = $('exportButton');
    button.disabled = true;
    try {
        await exportExcel(readable, state.settings.team);
    } catch (error) {
        alert(`Export fehlgeschlagen: ${error.message}`);
    } finally {
        button.disabled = false;
    }
}

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------

function teamRowHtml(member) {
    return `
    <div class="team-row" data-member="${esc(member.id)}">
        <input type="text" value="${esc(member.name)}" placeholder="Name" required>
        <button type="button" class="btn-delete-icon" data-action="remove-member" title="Entfernen">🗑️</button>
    </div>`;
}

function renderSettingsForm() {
    const s = state.settings;
    $('setCompany').value = s.company;
    $('teamList').innerHTML = s.team.map(teamRowHtml).join('');
    $('setStallSubject').value = s.templates.stall.subject;
    $('setStallBody').value = s.templates.stall.body;
    $('setRejectSubject').value = s.templates.reject.subject;
    $('setRejectBody').value = s.templates.reject.body;
}

async function saveSettings(event) {
    event.preventDefault();
    const settings = {
        company: $('setCompany').value.trim(),
        team: [...$('teamList').querySelectorAll('.team-row')].map(row => ({
            id: row.dataset.member,
            name: row.querySelector('input').value.trim()
        })),
        templates: {
            stall: { subject: $('setStallSubject').value, body: $('setStallBody').value },
            reject: { subject: $('setRejectSubject').value, body: $('setRejectBody').value }
        }
    };

    try {
        await api.saveSettings(await vault.encrypt(state.key, settings));
        state.settings = settings;
        renderAll();
        $('settingsStatus').textContent = '✅ Gespeichert';
        setTimeout(() => { $('settingsStatus').textContent = ''; }, 3000);
    } catch (error) {
        alert(`Speichern fehlgeschlagen: ${error.message}`);
    }
}

// ---------------------------------------------------------------------------
// Ereignisse
// ---------------------------------------------------------------------------

function switchView(name) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === name));
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('hidden', view.id !== `view-${name}`));
}

function bindEvents() {
    $('loginForm').addEventListener('submit', unlock);
    $('togglePassword').addEventListener('click', (event) => {
        const input = $('masterPassword');
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        event.currentTarget.textContent = show ? '🙈' : '👁️';
        event.currentTarget.title = show ? 'Passwort verbergen' : 'Passwort anzeigen';
    });
    $('lockButton').addEventListener('click', lock);

    document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => switchView(tab.dataset.view)));
    document.querySelectorAll('[data-close]').forEach(button =>
        button.addEventListener('click', () => $(button.dataset.close).classList.add('hidden')));

    $('uploadButton').addEventListener('click', () => {
        if (!state.aiReady && !confirm(`${$('aiStatus').title || 'Die KI ist nicht verfügbar.'}\n\nTrotzdem versuchen?`)) return;
        $('resumeFiles').click();
    });
    $('resumeFiles').addEventListener('change', async (event) => {
        await uploadResumes([...event.target.files]);
        event.target.value = '';
    });
    $('manualButton').addEventListener('click', () => showEditForm());
    $('editButton').addEventListener('click', () => showEditForm(findApplicant(state.currentId)));
    $('editForm').addEventListener('submit', saveEditForm);
    $('demoButton').addEventListener('click', loadDemoData);
    $('exportButton').addEventListener('click', handleExport);

    document.querySelectorAll('.search-input').forEach(input => input.addEventListener('input', renderAll));
    $('statusFilter').addEventListener('change', renderOverview);
    $('sortSelect').addEventListener('change', renderOverview);

    // Ein Klick-Handler für alle Tabellen (Event Delegation).
    document.querySelectorAll('tbody').forEach(tbody => {
        tbody.addEventListener('click', (event) => {
            const target = event.target.closest('[data-action]');
            if (!target) return;
            const id = Number(target.dataset.id);
            switch (target.dataset.action) {
                case 'open': return showView(id);
                case 'delete': return deleteApplicant(id);
                case 'mail-stall': return sendMail(id, 'stall');
                case 'mail-reject': return sendMail(id, 'reject');
            }
        });
        tbody.addEventListener('change', (event) => {
            if (event.target.dataset.action === 'toggle-read') {
                toggleRead(Number(event.target.dataset.id), event.target.checked);
            }
        });
    });

    $('settingsForm').addEventListener('submit', saveSettings);
    $('addMemberButton').addEventListener('click', () => {
        $('teamList').insertAdjacentHTML('beforeend', teamRowHtml({ id: newId(), name: '' }));
        $('teamList').lastElementChild.querySelector('input').focus();
    });
    $('teamList').addEventListener('click', (event) => {
        if (event.target.dataset.action === 'remove-member') event.target.closest('.team-row').remove();
    });
}

bindEvents();
initLogin();
