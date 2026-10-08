const path = require('path');
const express = require('express');
const multer = require('multer');
const { openDatabase, STATUSES } = require('./src/db');
const { extractResume, getStatus } = require('./src/ai');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = path.resolve(__dirname, process.env.DB_PATH || 'data/bewerbungen.db');
const MAX_FILES = 10;

const db = openDatabase(DB_PATH);
const app = express();

// PDFs bleiben nur im Arbeitsspeicher und landen nie auf der Festplatte.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: MAX_FILES, fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf')
});

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/exceljs.min.js', express.static(require.resolve('exceljs/dist/exceljs.min.js')));

const isCiphertext = (value) => typeof value === 'string' && value.length > 0;
const parseId = (req) => Number.parseInt(req.params.id, 10);

// --- Tresor: Salt und Prüfwert für das Master-Passwort ---

app.get('/api/vault', (req, res) => {
    const vault = db.getSetting('vault');
    res.json(vault ? { initialized: true, ...vault } : { initialized: false });
});

app.post('/api/vault', (req, res) => {
    if (db.getSetting('vault')) {
        return res.status(409).json({ error: 'Der Tresor ist bereits eingerichtet.' });
    }
    const { salt, iterations, check } = req.body;
    if (!isCiphertext(salt) || !Number.isInteger(iterations) || !isCiphertext(check)) {
        return res.status(400).json({ error: 'Ungültige Tresor-Daten.' });
    }
    db.setSetting('vault', { salt, iterations, check });
    res.status(201).json({ initialized: true, salt, iterations, check });
});

// --- Einstellungen (Team, Firma, Mail-Vorlagen) – ebenfalls verschlüsselt ---

app.get('/api/settings', (req, res) => {
    res.json({ data: db.getSetting('app') });
});

app.put('/api/settings', (req, res) => {
    if (!isCiphertext(req.body.data)) {
        return res.status(400).json({ error: 'Ungültige Einstellungen.' });
    }
    db.setSetting('app', req.body.data);
    res.json({ data: req.body.data });
});

// --- Bewerber ---

app.get('/api/applicants', (req, res) => {
    res.json(db.listApplicants());
});

app.post('/api/applicants', (req, res) => {
    const { data, status = 'offen' } = req.body;
    if (!isCiphertext(data) || !STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Ungültige Bewerberdaten.' });
    }
    res.status(201).json(db.createApplicant({ data, status }));
});

app.patch('/api/applicants/:id', (req, res) => {
    const { data, status, isRead } = req.body;
    if ((data !== undefined && !isCiphertext(data)) ||
        (status !== undefined && !STATUSES.includes(status)) ||
        (isRead !== undefined && typeof isRead !== 'boolean')) {
        return res.status(400).json({ error: 'Ungültige Änderung.' });
    }
    const updated = db.updateApplicant(parseId(req), { data, status, isRead });
    if (!updated) return res.status(404).json({ error: 'Bewerber nicht gefunden.' });
    res.json(updated);
});

app.delete('/api/applicants/:id', (req, res) => {
    if (!db.deleteApplicant(parseId(req))) {
        return res.status(404).json({ error: 'Bewerber nicht gefunden.' });
    }
    res.sendStatus(204);
});

// --- KI-Extraktion: liefert Klartext nur an den Browser zurück, speichert nichts ---

app.get('/api/ai/status', async (req, res) => {
    res.json(await getStatus());
});

app.post('/api/extract', upload.array('files', MAX_FILES), async (req, res) => {
    const files = req.files || [];
    if (files.length === 0) {
        return res.status(400).json({ error: 'Keine PDF-Dateien erhalten.' });
    }

    // Nacheinander verarbeiten: Ollama arbeitet Anfragen ohnehin der Reihe nach ab.
    const results = [];
    for (const file of files) {
        const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        try {
            results.push({ fileName, ok: true, data: await extractResume(file.buffer) });
        } catch (error) {
            console.error(`Fehler bei ${fileName}:`, error.message);
            results.push({ fileName, ok: false, error: error.message });
        }
    }
    res.json(results);
});

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        const message = err.code === 'LIMIT_FILE_COUNT'
            ? `Bitte maximal ${MAX_FILES} PDFs auf einmal hochladen.`
            : `Upload-Fehler: ${err.message}`;
        return res.status(400).json({ error: message });
    }
    console.error(err);
    res.status(500).json({ error: 'Interner Serverfehler.' });
});

app.listen(PORT, HOST, () => {
    console.log(`Bewerbungsmanager läuft auf http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`Datenbank: ${DB_PATH}`);
});
