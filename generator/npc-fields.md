## Die Felder des NPC

```json
{
  "id": "<kebab-case aus Kleinbuchstaben a–z, Ziffern und Bindestrichen, kurz und stabil — nur die id; der Anzeigename steht in name>",
  "name": "<Anzeigename>",
  "role": "<Einzeiler: wer ist das am Tisch>",
  "chapter": "<Kapitel-id, in dem die Figur eingeführt wird; ein neuer NPC trägt null>",
  "status": "alive | dead | missing | unknown",
  "statblock": "Roll20: <Sheet-Name>",
  "quickstats": [{ "key": "insight", "value": "+2" }],
  "voice": "<wie klingt er/sie>",
  "appearance": "<1-2 Merkmale>",
  "motivation": "<was die Figur will, 1-3 Sätze>",
  "body": "<der Fließtext des NPC, ein String mit echten Zeilenumbrüchen: Überschriften, Callouts, ## If:-Abschnitte>",
  "warnings": ["<kurzer deutscher Hinweis für den DM; eine leere Liste, wenn es nichts zu melden gibt>"]
}
```

Ein NPC trägt genau diese Felder. Jedes Feld, das der Quelltext nicht
hergibt, trägt `null`; `status` trägt immer einen der vier Werte.

`quickstats` ist eine Liste von Paaren `{ "key": …, "value": … }`, der Wert
immer als String (`"+2"`) — der Server setzt die Paare zu den Kurzwerten des
NPC zusammen.

`motivation` hält in 1-3 Sätzen, was die Figur in dieser Kampagne erreichen
will, und woran sie zerbricht. Figuren und Orte mit id aus der Kontextliste
stehen darin als `[[id]]`. Die NPC-Karte zeigt sie am Tisch.

Die Abschnitte im Feld `body` sind frei; empfohlen und in dieser
Reihenfolge:

1. `## Weiß` — Wissen, das allein dem DM gehört, als `[!secret]`-Callouts.
2. `## Beziehungen` — je Gegenpart eine Zeile `- [[<id>]]: <Freitext>`. Die
   id in doppelten eckigen Klammern verlinkt den Gegenpart, und die App setzt
   beim Anzeigen seinen aktuellen Namen ein. Gibt der Quelltext Beziehungen
   her, steht der Abschnitt; sonst entfällt er.

Jede `[[id]]` nennt etwas, das es gibt: eine id aus der Kontextliste, aus der
Gliederung dieses Durchlaufs oder die id dieses NPC selbst. Eine Figur oder
ein Ort ohne id steht mit dem Namen als normaler Text da, und die Lücke
gehört in eine `warning`.
