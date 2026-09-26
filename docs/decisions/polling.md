# Client-Aktualisierung über Polling

## Entscheidung

Änderungen werden in der App sichtbar, ohne manuell neu zu laden. Jeder Write
zählt `campaigns.version` in **derselben** Transaktion hoch. Die App pollt
`GET /api/campaigns/:campaign/version` (Antwort `{ version, build }`) und
invalidiert ihre Queries, wenn sich `version` ändert. Das Poll-Intervall ist
rein clientseitig.

`build` ist die Build-Id (`GRIMOIRE_BUILD`), die das Release-Image in Bundle
und Server einbrennt (`decisions/release`); weicht sie vom geladenen Bundle
ab, zeigt die App den Reload-Banner.

## Warum

Für einen Einzelnutzer (`decisions/scope`) reicht Polling. Weil die Version
in derselben Transaktion steigt wie die Änderung, kann ein Poll keine erhöhte
Version ohne die zugehörige Änderung sehen. SSE oder WebSockets lassen sich
später ohne API-Bruch nachrüsten; der Versionszähler bleibt dann als
Fallback gültig.

## Folgen

- `campaigns.version` ist ein Signal für die Aktualisierung, kein Wächter:
  Schreibzugriffe prüfen das `rev` ihrer Zeile (`decisions/writes`).
- Laufende Generator-Jobs pollt die App über ihre eigene Ressource
  (`decisions/generator`).
