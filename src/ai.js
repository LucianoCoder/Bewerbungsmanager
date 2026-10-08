const pdf = require('pdf-parse/lib/pdf-parse.js');

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

// Begrenzt die Textmenge, damit auch kleine Modelle nicht überlaufen.
const MAX_TEXT_LENGTH = 15000;

// Ollama erzwingt mit diesem Schema ein valides JSON-Objekt (Structured Outputs).
const RESUME_SCHEMA = {
    type: 'object',
    properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        birthDate: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        address: { type: 'string' },
        experience: { type: 'array', items: { type: 'string' } }
    },
    required: ['firstName', 'lastName', 'birthDate', 'email', 'phone', 'address', 'experience']
};

function buildPrompt(text) {
    return `Extrahiere die folgenden Informationen aus dem Lebenslauf und antworte ausschliesslich mit JSON.
Felder:
- firstName: Vorname(n)
- lastName: Nachname
- birthDate: Geburtsdatum im Format TT.MM.JJJJ (leer, falls nicht vorhanden)
- email, phone, address: Kontaktdaten (leer, falls nicht vorhanden)
- experience: Liste der beruflichen Stationen, je ein Eintrag im Format "Zeitraum: Position, Firma"
Erfinde nichts. Fehlende Angaben bleiben ein leerer String.

Lebenslauf:
${text.slice(0, MAX_TEXT_LENGTH)}`;
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
    const { text } = await pdf(new Uint8Array(pdfBuffer));
    if (!text || !text.trim()) {
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
                options: { temperature: 0 }
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

    const experience = Array.isArray(parsed.experience) ? parsed.experience : [parsed.experience];

    // Nur bekannte Felder als Strings zurückgeben.
    return {
        ...Object.fromEntries(
            Object.keys(RESUME_SCHEMA.properties).map(key => [key, String(parsed[key] ?? '').trim()])
        ),
        experience: experience
            .map(entry => String(entry ?? '').trim().replace(/^-\s*/, ''))
            .filter(Boolean)
            .map(entry => `- ${entry}`)
            .join('\n')
    };
}

module.exports = { extractResume, getStatus };
