# SQLite ist die Quelle der Wahrheit

## Entscheidung

Eine SQLite-Datenbank ist die **alleinige** Quelle der Wahrheit für
Kampagneninhalte: `GRIMOIRE_DATA/grimoire.db`. Es gibt keinen Spiegel auf das
Dateisystem, keinen Auto-Export und keinen Zwei-Wege-Abgleich.

- **Markdown ist das Inhaltsformat der `body`-Spalten** — und sonst nichts in
  der Speicherung. Das Body-Vokabular aus README.md (Callouts, `## If:`,
  Hashtags) ist normativ, und das Format degradiert statt zu validieren:
  unbekannte Callouts und Überschriften sind normaler Text, nie ein Fehler.
- **Ein Body ist ein Markdown-Feld** und in der UI als Markdown editierbar.
  „Blöcke als Zeilen" ist eine offen gelassene Option; das Schema verbaut sie
  nicht.
- **Das Glossar ist eine strukturierte Tabelle** (Begriff → Erklärung), kein
  Markdown-Blob.
- **Der Server liest keine Kampagnendateien.** Eine frische Instanz startet
  **leer**: der Boot öffnet die Datenbank, setzt die PRAGMAs, wendet die
  Schema-Migrationen an und meldet unterbrochene Generator-Jobs als
  gescheitert (`decisions/generator`), sonst nichts. Der Kaltstart einer
  echten Kampagne läuft in der UI.
- **`grimoire seed <dir>`** ist das Dev- und E2E-Werkzeug, das Zeilen in eine
  leere Datenbank schreibt (`bun run --filter @grimoire/server seed`, Report
  auf stdout). Es lädt die JSON-Fixtures über die Store-Schicht
  (`decisions/data-shape`). Außer ihm schreibt nur die App.
- **`GRIMOIRE_DATA`** (Default `./data`) hält `grimoire.db` samt `-wal`/`-shm`
  — die einzige Dateneinstellung überhaupt.
- **PRAGMAs:** `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- **Die Sicherung der DB-Datei ist Sache des Stack-Owners** (Volume-Backup,
  Hinweis in [docs/DEPLOYMENT.md](../DEPLOYMENT.md)); ein eigenes
  Backup-System ist kein Feature.
- **Treiber:** `node:sqlite` oder `bun:sqlite` hinter
  `server/src/db/driver.ts`, die eine eingetragene Bun-Kopplung
  (`decisions/stack`).

### Drizzle und Migrationen

- **ORM ist Drizzle** (`drizzle-orm`, `drizzle-kit` als Dev-Dependency).
  `server/src/db/schema.ts` ist die eine Quelle der Speicherform.
- **Migrationen sind generierte, committete SQL-Dateien** unter
  `server/src/db/migrations/` und werden beim Boot in einer Transaktion
  angewandt. Neue Migrationen entstehen über `drizzle-kit generate`.
- **Downgrade wird nicht unterstützt.** Der Rückweg ist die Volume-Sicherung
  plus ein Image-Rollback auf einen älteren Versions-Tag (`decisions/release`).
- **Die Kette beginnt mit einer Baseline,** `0000_baseline.sql`, dem Schema
  von v0.7. v0.7 ist die erste unterstützte Version; eine ältere Datenbank
  erkennt der Server nicht und behandelt sie nicht gesondert — es gibt keinen
  Versions-Riegel. Drizzles Migrator wendet eine Migration nur an, wenn ihr
  `when` im Journal größer ist als der `created_at` der zuletzt
  eingetragenen, und vergleicht keine Hashes. Deshalb ändern sich die
  `when`-Werte von `0000_baseline` (`1789757329900`) und
  `0001_scene_pos_per_chapter` (`1789760000000`) nie.
- **Migrationen werden nicht getestet.** Getestet wird das Verhalten, das sie
  ermöglichen — etwa der Constraint-Fehler am Schreibpfad —, nicht ihr SQL.

### Regeln für jede Migration

1. **Datenänderungen stehen in der Migration selbst.** Umzüge,
   Umformatierungen und Aufteilungen sind SQL der Migration und laufen in
   derselben Transaktion wie die Schemaänderung. Es gibt keinen Datenschritt
   vor oder nach dem Migrator, keine Vorabprüfung und keinen Boot-Durchgang.
2. **Nicht eindeutig Übertragbares entscheidet die Migration fest und
   verlustfrei** — etwa `NULL` setzen, den Wert sichtbar in den Text
   übernehmen oder ihn als eigenen Abschnitt anhängen. Die Migration
   entscheidet nachvollziehbar und dokumentiert, statt still zu raten; die
   Entscheidung steht in der Datei unter `docs/decisions/`, die die Änderung
   betrifft.
3. **Kein Code, der nur für eine Migration existiert.** Übergangscode gibt es
   nicht: ein Umbau wird so geschnitten, dass weder Adapter noch Doppelwege
   entstehen.
4. **Ungültige Daten entstehen gar nicht erst.** Das leisten CHECK-Constraints,
   Fremdschlüssel und die 400 am Schreibpfad (`decisions/constraints`).
   Deshalb braucht es keine Vorabprüfung.

### Suche

**FTS5** ist der Suchindex, angelegt als handgeschriebene Custom-Migration
(Tokenizer `unicode61 remove_diacritics 2`, Ranking
`bm25(search_fts, 10, 6, 4, 1)`) und explizit aus der Store-Schicht gepflegt.

## Warum

Gepflegt wird in der App (`decisions/writes`), also gehört die Wahrheit
hinter ihre API. Ein Spiegel oder Abgleich mit Dateien erzeugt eine ganze
Klasse von Konfliktproblemen; sie wird nicht gebaut.

Eine Baseline statt einer langen Kette hält neue Instanzen einfach: sie
brauchen nur den Endstand, und Code, der ältere Stände über eine Schwelle
bringt, hätte keinen Anwendungsfall, aber Pflegekosten. Aus demselben Grund
steht jede Datenänderung in der Migration: ein Datenschritt daneben ist
Übergangscode, der bleibt.

## Folgen

- Kein Code liest Kampagneninhalte von woanders als aus der Datenbank.
- Nicht Teil der Entscheidung: Export/Import, ein Trigram-Tokenizer für
  tippfehlertolerante Suche, Auto-Backups und Mehrnutzer-Betrieb
  (`decisions/scope`).
