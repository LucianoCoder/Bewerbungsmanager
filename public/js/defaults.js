// Standard-Einstellungen beim Einrichten eines neuen Tresors und fiktive Demo-Daten.

export const DEFAULT_SETTINGS = {
    company: 'Muster AG',
    team: [
        { id: 'm1', name: 'Anna' },
        { id: 'm2', name: 'Ben' },
        { id: 'm3', name: 'Chris' }
    ],
    templates: {
        stall: {
            subject: 'Ein kurzes Update zu Ihrer Bewerbung bei der {firma}',
            body: `Guten Tag {vorname} {nachname}

Vielen Dank für Ihre Bewerbung und Ihre Geduld.

Wir möchten jeder Bewerbung die Aufmerksamkeit schenken, die sie verdient. Für die sorgfältige Prüfung benötigen wir deshalb noch etwas mehr Zeit als ursprünglich geplant.

Wir haben Sie nicht vergessen und melden uns so bald wie möglich mit einem konkreten Update zum weiteren Ablauf.

Herzlichen Dank für Ihr Verständnis.

Freundliche Grüsse
Ihr Team der {firma}`
        },
        reject: {
            subject: 'Ihre Bewerbung bei der {firma}',
            body: `Guten Tag {vorname} {nachname}

Vielen Dank für Ihr Interesse an der {firma} und die Zeit, die Sie in Ihre Bewerbung investiert haben.

Nach sorgfältiger Prüfung haben wir uns für eine andere Person entschieden, deren Profil noch etwas genauer zu unseren aktuellen Anforderungen passt. Bitte verstehen Sie diesen Entscheid nicht als Wertung Ihrer Qualifikationen oder Ihrer Persönlichkeit.

Ihre Bewerbungsunterlagen löschen wir datenschutzkonform.

Für Ihren weiteren beruflichen Weg wünschen wir Ihnen viel Erfolg.

Freundliche Grüsse
Ihr Team der {firma}`
        }
    }
};

// Fiktive Personen zum Ausprobieren. Bewertungen werden den ersten Team-Mitgliedern zugeordnet.
const DEMO_APPLICANTS = [
    {
        firstName: 'Laura', lastName: 'Beispiel', birthDate: '14.03.1994',
        email: 'laura.beispiel@example.com', phone: '+41 79 000 00 00', address: 'Musterweg 12, 3000 Bern',
        experience: '- 04/2021 - heute: Sachbearbeiterin Administration, Muster Logistik AG\n- 08/2017 - 03/2021: Kaufmännische Angestellte, Beispiel Garage GmbH\n- 08/2014 - 07/2017: KV-Lehre (EFZ), Gemeindeverwaltung Musterhausen',
        ratings: [['A', 'Sehr strukturiert, passende Erfahrung.'], ['A', ''], ['B', 'Französisch noch ausbaufähig.']],
        status: 'offen', isRead: true
    },
    {
        firstName: 'Marco', lastName: 'Muster', birthDate: '02.11.1988',
        email: 'marco.muster@example.com', phone: '+41 78 111 11 11', address: 'Bahnhofstrasse 5, 8000 Zürich',
        experience: '- 2019 - heute: Teamleiter Kundendienst, Fiktiv Versicherungen AG\n- 2013 - 2019: Kundenberater, Fiktiv Versicherungen AG',
        ratings: [['B', 'Gute Führungserfahrung.'], ['C', 'Lohnvorstellung zu hoch.']],
        status: 'hingehalten', isRead: true
    },
    {
        firstName: 'Sofia', lastName: 'Exempel', birthDate: '21.07.1999',
        email: 'sofia.exempel@example.com', phone: '+41 76 222 22 22', address: 'Seeweg 3, 6000 Luzern',
        experience: '- 2022 - heute: Junior Buchhalterin, Treuhand Probe GmbH\n- 2018 - 2021: Bachelor Betriebsökonomie, Hochschule Luzern',
        ratings: [['A', 'Motiviert, schnelle Auffassungsgabe.']],
        status: 'offen', isRead: false
    },
    {
        firstName: 'Jonas', lastName: 'Platzhalter', birthDate: '09.01.1991',
        email: 'jonas.platzhalter@example.com', phone: '+41 77 333 33 33', address: 'Hauptgasse 20, 4500 Solothurn',
        experience: '- 2016 - heute: Disponent, Transport Test AG',
        ratings: [['C', 'Profil passt nicht.'], ['C', ''], ['C', '']],
        status: 'abgesagt', isRead: true
    },
    {
        firstName: 'Nina', lastName: 'Vorlage', birthDate: '30.05.1996',
        email: 'nina.vorlage@example.com', phone: '+41 79 444 44 44', address: 'Rue Fictive 8, 2500 Biel/Bienne',
        experience: '- 2020 - heute: Assistentin der Geschäftsleitung, Demo Holding AG\n- 2015 - 2020: Sachbearbeiterin, Demo Holding AG',
        ratings: [],
        status: 'offen', isRead: false
    }
];

export function demoApplicants(team) {
    return DEMO_APPLICANTS.map(({ ratings, status, isRead, ...data }) => ({
        status,
        isRead,
        data: {
            ...data,
            reviews: Object.fromEntries(
                ratings.slice(0, team.length).map(([rating, comment], i) => [team[i].id, { rating, comment }])
            )
        }
    }));
}
