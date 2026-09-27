## Die Felder der Szene

```json
{
  "id": "<kebab-case ASCII, Englisch, kurz und stabil — nur die id; der Anzeigetext steht in title>",
  "title": "<Anzeigetitel der Szene>",
  "type": "planned | contingency",
  "trigger": "<nur bei contingency: woran die Szene ausgelöst wird; sonst null>",
  "chapter": "<Kapitel-id aus dem Kontext>",
  "location": "<Orts-id aus dem Kontext oder der Gliederung; sonst null>",
  "npcs": ["<npc-ids aus dem Kontext oder der Gliederung>"],
  "handouts": ["<Roll20-Namen als Verweis>"],
  "tags": ["<frei; empfohlen: combat, social, stealth, travel>"],
  "status": "draft | ready | played | dropped",
  "body": "<der Fließtext der Szene, ein String mit echten Zeilenumbrüchen>",
  "warnings": ["<kurzer deutscher Hinweis für den DM; eine leere Liste, wenn es nichts zu melden gibt>"]
}
```

Eine Szene trägt genau diese Felder. `trigger` und `location` tragen `null`,
wenn der Quelltext nichts hergibt, `npcs`, `handouts` und `tags` dann `[]`.
`chapter` ist immer die Kapitel-id aus dem Kontext. Eine neue Szene trägt
immer `status: draft`.

Der String in `body` ist in dieser Ordnung aufgebaut:

1. `## Flow` — die Situation, wie sie am Tisch läuft.
2. Beliebig viele `## If: <Bedingung>` — Verzweigungen derselben Situation.
3. Callouts stehen IN diesen Abschnitten: `[!readaloud]` für Vorlesetext,
   `[!check]` für jede Würfelmechanik, `[!secret]` für Wissen, das allein dem
   DM gehört, `[!outcome]` für szenenübergreifende Konsequenzen, `[!loot]`
   für Beute, `[!note]` für DM-Hinweise. Genau diese sechs Typen.
4. Referenzen im Text: NPCs, Orte und Szenen mit id aus der Kontextliste
   als `[[id]]`, ohne Anzeigetext, Endungen außerhalb der Klammern.
