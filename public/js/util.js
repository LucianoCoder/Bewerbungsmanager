// Kleine Hilfsfunktionen ohne Abhängigkeiten.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Alle Bewerberdaten stammen aus fremden PDFs und werden vor dem Einfügen ins HTML escaped.
export function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}

export function fullName(applicant) {
    return [applicant.firstName, applicant.lastName].filter(Boolean).join(' ') || 'Unbekannt';
}

export function formatDate(iso) {
    return iso ? new Date(iso).toLocaleDateString('de-CH') : '';
}

// Ersetzt {vorname}, {nachname}, {firma} in Mail-Vorlagen.
export function fillTemplate(template, values) {
    return template.replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match));
}

export function newId() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
