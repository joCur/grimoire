## Bestehende Figuren und Orte ergänzen

Dieser Durchlauf darf auch Figuren und Orte ergänzen, die der Kontext schon
nennt.

1. **existingNpcs** und **existingLocations**: Erzählt der Quelltext über
   eine Figur oder einen Ort aus dem Kontext **mehr**, als die Kampagne schon
   kennt — ein Geheimnis, ein Motiv, ein Aussehen, eine Beschreibung —, gehört
   sie nach `existingNpcs` bzw. `existingLocations`, mit ihrer `id` aus dem
   Kontext und einem Satz, der sagt, was hinzukommt.
2. Eine Figur oder ein Ort, die der Quelltext nur nennt, ohne etwas über sie
   zu erzählen, bleibt draußen.
3. Jede `id` kommt im ganzen Durchlauf genau EINMAL vor — über `scenes`,
   `npcs`, `locations`, `existingNpcs` und `existingLocations` zusammen. Was
   in `existingNpcs` oder `existingLocations` steht, gehört nicht zugleich
   nach `npcs` oder `locations`.
4. Alle vier Listen zusammen nennen höchstens 12 Figuren und Orte.
