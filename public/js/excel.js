// Excel-Export im Browser. ExcelJS (~1 MB) wird erst beim ersten Export geladen.
// Der Export entsteht vollständig im Browser, der Server sieht keine Klartextdaten.

import { formatDate } from './util.js';

const STATUS_LABELS = { offen: 'Offen', hingehalten: 'Hingehalten', abgesagt: 'Abgesagt' };

function loadExcelJs() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/vendor/exceljs.min.js';
        script.onload = () => resolve(window.ExcelJS);
        script.onerror = () => reject(new Error('ExcelJS konnte nicht geladen werden.'));
        document.head.appendChild(script);
    });
}

export async function exportExcel(applicants, team) {
    const ExcelJS = await loadExcelJs();

    const rows = applicants.map(a => {
        const row = {
            'Vorname': a.firstName || '',
            'Nachname': a.lastName || '',
            'Geburtsdatum': a.birthDate || '',
            'E-Mail': a.email || '',
            'Telefon': a.phone || '',
            'Adresse': a.address || '',
            'Status': STATUS_LABELS[a.status] || a.status,
            'Gelesen': a.isRead ? 'Ja' : 'Nein',
            'Erfasst am': formatDate(a.createdAt),
            'Berufserfahrung': a.experience || ''
        };
        for (const member of team) {
            const review = a.reviews?.[member.id] || {};
            row[`Bewertung ${member.name}`] = review.rating || '';
            row[`Kommentar ${member.name}`] = review.comment || '';
        }
        return row;
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Bewerber');
    const keys = Object.keys(rows[0]);

    // Spaltenbreite nach längster Zeile, maximal 60 Zeichen.
    sheet.columns = keys.map(key => {
        const longest = Math.max(key.length, ...rows.flatMap(row => String(row[key]).split('\n').map(line => line.length)));
        return { header: key, key, width: Math.min(longest + 2, 60) };
    });
    sheet.addRows(rows);
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.eachRow(row => { row.alignment = { vertical: 'top', wrapText: true }; });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Bewerber_${new Date().toISOString().slice(0, 10)}.xlsx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
