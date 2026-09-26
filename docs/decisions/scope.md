# Umfang: ein Werkzeug für einen Spielleiter

## Entscheidung

Grimoire ist ein selbst gehostetes Einzelnutzer-Werkzeug für einen
D&D-Spielleiter: Session-Vorbereitung und Live-Moderation über einer
Kampagnen-Datenbank. Es ist kein VTT, kein Kampagnen-Wiki und hat keine
Spieler-Ansicht.

### Kein Roll20-Sync

Grimoire hält, was nur der DM sieht: Read-Alouds, Notizen, Geheimnisse,
Logs. Roll20 hält, was Spieler sehen und anfassen: Karten, Tokens,
Spieler-Handouts, Statblocks. Die Brücke ist unidirektional und manuell
(Copy-Button, Handout-Verweise per Name). Einen bidirektionalen Sync gibt es
nicht.

### Zugriffsschutz vor der App, nicht in der App

Es gibt kein Account-System. Zugriffsschutz ist eine Entscheidung des
Deployments: Tailscale als Standard, alternativ Basic Auth oder Forward Auth
(Authelia, authentik) im Reverse Proxy. Die App selbst ist auth-agnostisch.
Die einzige Folge in der App: alle Schreibzugriffe laufen über den Server,
und es gibt keinen persistenten Browser-State.

## Warum

Die Trennung zu Roll20 folgt der Sichtbarkeit: was Spieler sehen, lebt dort,
wo die Spieler sind. Ein bidirektionaler Sync bräuchte Konfliktauflösung,
eine Umwandlung zwischen HTML und Markdown und eine offizielle REST-API, die
Roll20 nicht hat.

Für einen einzelnen Nutzer ist ein Account-System Aufwand ohne Gegenwert;
ein Proxy davor schützt genauso und kostet keinen App-Code.

## Folgen

- Wird App-seitige Authentifizierung doch nötig, wird zuerst geprüft, ob
  Forward Auth im Proxy reicht; das deckt auch den Zugriff von fremden
  Geräten ab. Sonst ist es ein Middleware-Layer in Hono (Basic Auth, JWT,
  Sessions), kein Umbau.
- Echte Mehrnutzer- oder Rechte-Anforderungen betreffen Datenmodell und
  Auth-Modell; an dem Punkt wird neu entschieden statt angebaut.
- Kein localStorage für Daten: der Server ist die Wahrheit.
