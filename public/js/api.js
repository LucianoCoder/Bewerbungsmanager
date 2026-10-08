// Schlanke Hülle um die REST-Schnittstelle des Servers.

async function request(method, url, body) {
    const options = { method };
    if (body instanceof FormData) {
        options.body = body;
    } else if (body !== undefined) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(body);
    }

    let res;
    try {
        res = await fetch(url, options);
    } catch {
        throw new Error('Der Server ist nicht erreichbar. Läuft „npm start“ noch?');
    }

    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Serverfehler (${res.status})`);
    return data;
}

export const api = {
    getVault: () => request('GET', '/api/vault'),
    createVault: (vault) => request('POST', '/api/vault', vault),

    getSettings: () => request('GET', '/api/settings'),
    saveSettings: (data) => request('PUT', '/api/settings', { data }),

    listApplicants: () => request('GET', '/api/applicants'),
    createApplicant: (applicant) => request('POST', '/api/applicants', applicant),
    updateApplicant: (id, changes) => request('PATCH', `/api/applicants/${id}`, changes),
    deleteApplicant: (id) => request('DELETE', `/api/applicants/${id}`),

    getAiStatus: () => request('GET', '/api/ai/status'),
    extract: (files) => {
        const formData = new FormData();
        for (const file of files) formData.append('files', file);
        return request('POST', '/api/extract', formData);
    }
};
