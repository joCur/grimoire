## Die Felder des Orts

```json
{
  "id": "<kebab-case aus Kleinbuchstaben a–z, Ziffern und Bindestrichen, kurz und stabil — nur die id; der Anzeigename steht in name>",
  "name": "<Anzeigename>",
  "chapter": "<Kapitel-id aus der Kontextliste oder der Gliederung; nur wenn eindeutig, sonst null>",
  "roll20Page": "<Page-Name als Verweis auf die Roll20-Seite; sonst null>",
  "atmosphere": "<was der Ort über sich verrät, 1-3 Sätze>",
  "body": "<der Fließtext des Orts, ein String mit echten Zeilenumbrüchen: Überschriften, Callouts, ## If:-Abschnitte>",
  "warnings": ["<kurzer deutscher Hinweis für den DM; eine leere Liste, wenn es nichts zu melden gibt>"]
}
```

Ein Ort trägt genau diese Felder. Jedes Feld, das der Quelltext nicht
hergibt, trägt `null`.

`atmosphere` hält in 1-3 Sätzen, was der Ort über sich verrät: Zustand,
Geräusche, Gerüche, was auffällt. Figuren und Orte mit id aus der
Kontextliste stehen darin als `[[id]]`. Die Ort-Karte zeigt sie am Tisch.

Die Abschnitte im Feld `body` sind frei; empfohlen und in dieser Reihenfolge:

1. `## Beim ersten Betreten` — der erste Eindruck, als `[!readaloud]`.
2. `## Wer ist hier` — Liste der Figuren/Gruppen am Ort, NPCs mit id als
   `[[id]]`.

Jede `[[id]]` nennt etwas, das es gibt: eine id aus der Kontextliste, aus der
Gliederung dieses Durchlaufs oder die id dieses Orts selbst. Eine Figur oder
ein Ort ohne id steht mit dem Namen als normaler Text da, und die Lücke
gehört in eine `warning`.
