// Ende-zu-Ende-Verschlüsselung im Browser mit der Web Crypto API.
// Aus dem Master-Passwort wird per PBKDF2 ein AES-256-GCM-Schlüssel abgeleitet.
// Der Server sieht weder das Passwort noch den Schlüssel noch Klartextdaten.

export const DEFAULT_ITERATIONS = 600000;
const CHECK_VALUE = 'bewerbungsmanager-tresor';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (text) => Uint8Array.from(atob(text), c => c.charCodeAt(0));

export function isSupported() {
    return Boolean(window.crypto && window.crypto.subtle);
}

export function createSalt() {
    return toBase64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function deriveKey(password, salt, iterations = DEFAULT_ITERATIONS) {
    const baseKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: fromBase64(salt), iterations, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

// Format: "<iv>.<ciphertext>", beides Base64.
export async function encrypt(key, value) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value)));
    return `${toBase64(iv)}.${toBase64(ciphertext)}`;
}

// Wirft einen Fehler, wenn der Schlüssel nicht passt oder die Daten verändert wurden.
export async function decrypt(key, payload) {
    const [iv, ciphertext] = payload.split('.');
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(ciphertext));
    return JSON.parse(decoder.decode(plaintext));
}

// Prüfwert, mit dem beim Entsperren das Passwort kontrolliert wird.
export function createCheck(key) {
    return encrypt(key, CHECK_VALUE);
}

export async function verifyCheck(key, check) {
    try {
        return (await decrypt(key, check)) === CHECK_VALUE;
    } catch {
        return false;
    }
}
