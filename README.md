# Webapp für Ansicht der Kurskalender an der DHBW Lörrach

Webanwendung, die die ICS-Kurskalender der DHBW Lörrach als HTML-Kalender
darstellt — mit Wochen-, Monats- und Listenansicht, Kursauswahl und
teilbaren URLs.

## Kurse eintragen

Die Datei `courses.example.json` kopieren nach `public/courses.json` und
dort die gewünschten Kurs-Codes eintragen.

## Starten

```sh
python3 server.py        # Port 8000
python3 server.py 9000   # anderer Port
```

Dann <http://localhost:8000/> öffnen. Es ist nur Python 3 (Standardbibliothek)
nötig, kein Build-Schritt, keine Abhängigkeiten.

`server.py` liefert die statischen Dateien aus und proxyt `GET /ics/<kurs>`
zum DHBW-Server (`webmail.dhbw-loerrach.de`), weil dieser keine CORS-Header
sendet. Antworten werden zehn Minuten im Speicher gecacht — gleich
lange wie im Browser, sodass Stundenplanänderungen nach spätestens
~20 Minuten sichtbar sind. Das gilt auch für einen geöffneten Tab ohne
Interaktion: Der Client lädt abgelaufene Feeds selbsttätig nach.

## URL-Schema (Bookmarks/Teilen)

```
http://localhost:8000/?kurs=TIF25A&ansicht=woche&datum=2026-06-08
```

| Parameter | Werte | Default |
|---|---|---|
| `kurs` | Kurskürzel, z. B. `TIF25A`, `WWI24B` | - |
| `ansicht` | `woche`, `monat`, `liste` | `woche` |
| `datum` | ISO-Datum als Anker der Ansicht | heute |

`datum` wird beim Navigieren nur in die URL geschrieben, wenn es nicht
„heute" ist — ein Bookmark ohne `datum` zeigt also immer die aktuelle Woche.

## Kursliste pflegen

Die Auswahlliste kommt aus `courses.json` (flaches Array von Kürzeln).
Neue Kurse einfach ergänzen; die Gruppierung im Dropdown wird aus dem
Kürzel abgeleitet. Kurse, die nicht in der Liste stehen, sind über das
Freitextfeld oder direkt per URL erreichbar — der Kalender existiert,
sobald die DHBW unter
`https://stash.dhbw-loerrach.de/calendar/kal-<kurs>@dhbw-loerrach.de.ics`
eine Datei bereitstellt.

## Dateien

Der Python-Code in `server.py` definiert einen Statischer Server und ICS-Proxy (Python-Stdlib).

Im Verzeichnis `public` befinden sich Dateien mit dem Code für die Webapp: 

| Datei | Aufgabe |
|---|---|
| `index.html` | Seitengerüst |
| `style.css` | Gestaltung |
| `app.js` | Zustand, URL-Synchronisation, Steuerung |
| `ics.js` | Minimaler ICS-Parser |
| `views.js` | Renderer der drei Ansichten |
| `dhbw-logo.svg` | Logo der DHBW als SVG |
| `courses.json` | Gepflegte Kursliste (muss erstellt werden, siehe `courses.example.json`) |
