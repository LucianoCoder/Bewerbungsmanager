const pdf = require('pdf-parse/lib/pdf-parse.js');

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3.5';

// Begrenzt die Textmenge, damit auch kleine Modelle nicht überlaufen.
const MAX_TEXT_LENGTH = 15000;

// Ollama nutzt standardmässig ein kleines Kontextfenster und schneidet längere
// Lebensläufe sonst stillschweigend ab.
const CONTEXT_SIZE = 8192;

// Ollama erzwingt mit diesem Schema ein valides JSON-Objekt (Structured Outputs).
// Jede berufliche Station hat eigene Felder: Kleine Modelle füllen einzelne Felder
// zuverlässiger aus, als ein vorgegebenes Textformat nachzubauen.
const RESUME_SCHEMA = {
    type: 'object',
    properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        birthDate: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        address: { type: 'string' },
        experience: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    period: { type: 'string' },
                    position: { type: 'string' },
                    company: { type: 'string' },
                    location: { type: 'string' },
                    tasks: { type: 'string' }
                },
                required: ['period', 'position', 'company', 'location', 'tasks']
            }
        }
    },
    required: ['firstName', 'lastName', 'birthDate', 'email', 'phone', 'address', 'experience']
};

const CONTACT_FIELDS = ['firstName', 'lastName', 'birthDate', 'email', 'phone', 'address'];

function buildPrompt(text) {
    return `Du liest einen Lebenslauf aus und antwortest ausschliesslich mit JSON.

Felder:
- firstName, lastName: Vor- und Nachname der Person
- birthDate: Geburtsdatum im Format TT.MM.JJJJ
- email, phone, address: Kontaktdaten der Person
- experience: alle beruflichen Stationen (Anstellungen, Praktika), auch von weiteren Seiten. Pro Station:
  - period: Zeitraum genau wie im Lebenslauf, z. B. "03/2019 – heute"
  - position: Berufsbezeichnung bzw. Funktion
  - company: Name des Arbeitgebers
  - location: Ort des Arbeitgebers
  - tasks: die wichtigsten Tätigkeiten als Stichworte, höchstens 15 Wörter

Regeln:
- Übernimm die Angaben aus dem Text, erfinde nichts.
- Ausbildung, Weiterbildungen, Zertifikate, Sprachen und Hobbys gehören nicht zu experience.
- Fehlt eine Angabe, bleibt das Feld ein leerer String.
- Der Text kann durch mehrspaltige Layouts durcheinander sein. Ordne die Angaben sinngemäss zu.

Lebenslauf:
${text}`;
}

// Entfernt Leerzeilen und überflüssige Leerzeichen, damit mehr Inhalt ins Kontextfenster passt.
function cleanText(text) {
    return text
        .split('\n')
        .map(line => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n')
        .slice(0, MAX_TEXT_LENGTH);
}

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const digitsOf = (value) => String(value).replace(/\D/g, '');

const MAX_TASKS_LENGTH = 160;

// Kürzt lange Tätigkeitslisten an einer Satz- oder Aufzählungsgrenze.
function shortenTasks(tasks) {
    if (tasks.length <= MAX_TASKS_LENGTH) return tasks;
    let result = '';
    for (const part of tasks.split(/(?<=[;.])\s+/)) {
        if ((result + ' ' + part).length > MAX_TASKS_LENGTH) break;
        result = result ? `${result} ${part}` : part;
    }
    if (!result) result = tasks.slice(0, tasks.lastIndexOf(' ', MAX_TASKS_LENGTH));
    return `${result.replace(/[;,.]$/, '')} …`;
}

// Kleine Modelle erfinden gelegentlich Werte. Kontaktangaben werden deshalb nur
// übernommen, wenn sie tatsächlich im Lebenslauf vorkommen.
function isInText(field, value, text) {
    if (!value) return false;
    if (field === 'email') return text.toLowerCase().includes(value.toLowerCase());
    if (field === 'phone') {
        const digits = digitsOf(value);
        return digits.length >= 6 && digitsOf(text).includes(digits.slice(-6));
    }
    if (field === 'birthDate') {
        const year = value.match(/\d{4}/);
        return Boolean(year) && text.includes(year[0]);
    }
    return true;
}

// Setzt eine Station als lesbaren Text zusammen, z. B.
// "- 03/2019 – heute: Sachbearbeiterin, Muster AG, Bern\n  Buchhaltung und Kundenkontakt"
function formatStation(station) {
    if (typeof station !== 'object' || station === null) return clean(station) && `- ${clean(station)}`;
    const period = clean(station.period).replace(/\s+-\s+/g, ' – ');
    const company = clean(station.company);
    let location = clean(station.location);
    if (location && company.toLowerCase().includes(location.toLowerCase())) location = '';
    const title = [clean(station.position), company, location].filter(Boolean).join(', ');
    const head = [period, title].filter(Boolean).join(': ');
    if (!head) return '';
    const tasks = shortenTasks(clean(station.tasks));
    return `- ${head}${tasks ? `\n  ${tasks}` : ''}`;
}

async function getStatus() {
    try {
        const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { models = [] } = await res.json();
        const names = models.map(m => m.name);
        const modelInstalled = names.includes(OLLAMA_MODEL) || names.includes(`${OLLAMA_MODEL}:latest`);
        return { available: true, model: OLLAMA_MODEL, modelInstalled };
    } catch {
        return { available: false, model: OLLAMA_MODEL, modelInstalled: false };
    }
}

async function extractResume(pdfBuffer) {
    // Kopie anlegen: Multer liefert kleine Dateien als Ausschnitt eines gemeinsamen
    // Speicherpuffers, den die ältere pdf.js-Version in pdf-parse sonst komplett liest.
    const { text: rawText } = await pdf(new Uint8Array(pdfBuffer));
    const text = cleanText(rawText || '');
    if (!text) {
        throw new Error('Das PDF enthält keinen lesbaren Text (evtl. ein eingescanntes Bild).');
    }

    let res;
    try {
        res = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                prompt: buildPrompt(text),
                format: RESUME_SCHEMA,
                stream: false,
                think: false, // "Denkende" Modelle (z. B. qwen) wären sonst um ein Vielfaches langsamer
                options: { temperature: 0, num_ctx: CONTEXT_SIZE }
            })
        });
    } catch {
        throw new Error(`Ollama ist unter ${OLLAMA_URL} nicht erreichbar. Läuft Ollama?`);
    }

    if (res.status === 404) {
        throw new Error(`Das KI-Modell „${OLLAMA_MODEL}“ ist nicht installiert. Bitte im Terminal ausführen: ollama pull ${OLLAMA_MODEL}`);
    }
    if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Ollama-Fehler (${res.status}): ${detail.slice(0, 200)}`);
    }

    const { response } = await res.json();
    const parsed = JSON.parse(response);

    const experience = Array.isArray(parsed.experience) ? parsed.experience : [];

    return {
        ...Object.fromEntries(CONTACT_FIELDS.map(key => {
            const value = clean(parsed[key]);
            return [key, isInText(key, value, text) ? value : ''];
        })),
        experience: experience.map(formatStation).filter(Boolean).join('\n')
    };
}

module.exports = { extractResume, getStatus };
