```json
{
  "scenes": [
    {
      "id": "harbour-arrival",
      "title": "Ankunft im Hafen",
      "type": "planned",
      "location": "hafen",
      "sourceExcerpt": {
        "first": "The characters arrive at the harbour on the evening tide.",
        "last": "Jorna, the harbormaster, is waiting for them at the pier."
      },
      "refs": []
    },
    {
      "id": "night-watch-quay",
      "title": "Nachtwache am Kai",
      "type": "planned",
      "location": "bucht",
      "sourceExcerpt": {
        "first": "At low tide the party can watch the quay from the northern shore.",
        "last": "Two lanterns move along the mole while the crew shifts a cargo."
      },
      "refs": ["smuggler-captured"]
    },
    {
      "id": "smuggler-captured",
      "title": "Von Schmugglern erwischt",
      "type": "contingency",
      "location": "bucht",
      "sourceExcerpt": {
        "first": "If the characters are spotted while scouting the cove, they are disarmed.",
        "last": "The characters have until dawn to escape."
      },
      "refs": ["night-watch-quay"]
    }
  ],
  "entries": [
    {
      "kind": "npc",
      "id": "grella",
      "name": "Grella",
      "summary": "Schmugglerin, bringt die Ladung ins Dorf und will ihren Anteil."
    },
    {
      "kind": "location",
      "id": "bucht",
      "name": "Nordbucht",
      "summary": "Die flache Bucht nördlich des Hafens, bei Ebbe zu Fuß erreichbar."
    }
  ],
  "warnings": [
    "Der Quelltext nennt keine Statblocks für die Schmuggler — bitte nachtragen."
  ]
}
```
