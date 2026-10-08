const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// Der Server speichert personenbezogene Daten nur verschlüsselt (encrypted_data).
// Klartext sind lediglich Status, Gelesen-Markierung und Erfassungsdatum.
const STATUSES = ['offen', 'hingehalten', 'abgesagt'];

function openDatabase(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);

    db.exec(`
        CREATE TABLE IF NOT EXISTS applicants (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            encrypted_data TEXT    NOT NULL,
            status         TEXT    NOT NULL DEFAULT 'offen' CHECK (status IN ('offen', 'hingehalten', 'abgesagt')),
            is_read        INTEGER NOT NULL DEFAULT 0,
            created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    `);

    const toApplicant = (row) => row && {
        id: row.id,
        data: row.encrypted_data,
        status: row.status,
        isRead: row.is_read === 1,
        createdAt: row.created_at
    };

    const stmts = {
        list: db.prepare('SELECT * FROM applicants ORDER BY id'),
        get: db.prepare('SELECT * FROM applicants WHERE id = ?'),
        insert: db.prepare('INSERT INTO applicants (encrypted_data, status) VALUES (?, ?)'),
        remove: db.prepare('DELETE FROM applicants WHERE id = ?'),
        getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
        setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    };

    return {
        listApplicants: () => stmts.list.all().map(toApplicant),

        getApplicant: (id) => toApplicant(stmts.get.get(id)),

        createApplicant: ({ data, status = 'offen' }) => {
            const { lastInsertRowid } = stmts.insert.run(data, status);
            return toApplicant(stmts.get.get(lastInsertRowid));
        },

        // Aktualisiert nur die übergebenen Felder.
        updateApplicant: (id, { data, status, isRead }) => {
            const columns = [];
            const values = [];
            if (data !== undefined) { columns.push('encrypted_data = ?'); values.push(data); }
            if (status !== undefined) { columns.push('status = ?'); values.push(status); }
            if (isRead !== undefined) { columns.push('is_read = ?'); values.push(isRead ? 1 : 0); }
            if (columns.length > 0) {
                db.prepare(`UPDATE applicants SET ${columns.join(', ')} WHERE id = ?`).run(...values, id);
            }
            return toApplicant(stmts.get.get(id));
        },

        deleteApplicant: (id) => stmts.remove.run(id).changes > 0,

        getSetting: (key) => {
            const row = stmts.getSetting.get(key);
            return row ? JSON.parse(row.value) : null;
        },

        setSetting: (key, value) => stmts.setSetting.run(key, JSON.stringify(value))
    };
}

module.exports = { openDatabase, STATUSES };
