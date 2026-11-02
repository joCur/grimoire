## Gliederung mit Ergänzungsmaterial

1. **Herkunft jeder Szene**: Eine Szene stammt aus dem Quelltext, aus dem
   Ergänzungsmaterial oder aus beiden. Die Szenen des Quelltexts bilden das
   Gerüst der Gliederung. Erweitert das Ergänzungsmaterial eine dieser Szenen,
   bleibt sie EINE Szene mit beiden Abschnitten; bringt es eine eigene
   Situation mit, wird sie eine eigene Szene.
2. **supplementExcerpt**: `first` und `last` sind wörtliche Zitate aus dem
   Ergänzungsmaterial — der erste und der letzte Satz des Abschnitts, aus dem
   die Szene schöpft, Zeichen für Zeichen, wie bei `sourceExcerpt`. Eine Szene
   aus dem Quelltext allein trägt `sourceExcerpt` und `supplementExcerpt:
   null`, eine Szene aus dem Ergänzungsmaterial allein `sourceExcerpt: null`
   und `supplementExcerpt`, eine Szene aus beiden Texten beide Zitate.
3. **Eine Reihenfolge**: `scenes` ordnet alle Szenen so, wie sie am Tisch
   gespielt werden — jede Szene des Ergänzungsmaterials an der Stelle, an die
   sie im Ablauf des Quelltexts gehört.
4. **Figuren und Orte** aus dem Ergänzungsmaterial gehören wie die des
   Quelltexts nach `npcs` und `locations`.
5. Die Gliederung nennt höchstens 20 Szenen.
