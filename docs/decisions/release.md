# Release: release-please, Versions-Tags, `:latest` nur bei Releases

## Entscheidung

Ein Deploy ist ein bewusstes Ereignis mit Changelog. `main` ist per Definition
deploybar, veröffentlicht aber nichts: Images entstehen nur beim Release.

- **Conventional Commits sind Pflicht,** sie erzeugen den Changelog: `feat:`
  (Minor), `fix:` (Patch), `docs:`/`chore:`/`refactor:`/`test:`/`ci:` (kein
  Bump); ein Breaking Change ist `feat!:` oder ein `BREAKING CHANGE:`-Footer.
  Das gilt auch für den PR-Titel, weil der Squash-Merge ihn als
  Commit-Betreff übernimmt.
- **release-please** (`googleapis/release-please-action@v4` in
  `.github/workflows/release.yml`) läuft bei jedem Push auf `main` und hält aus
  den Commits einen Release-PR. Die Konfiguration liegt im Root
  (`release-please-config.json`, `.release-please-manifest.json`): ein Package
  `"."`, `release-type: node`, `include-component-in-tag: false` und ein
  **leerer `package-name`** — nicht ein leeres `component`; sonst fällt die
  Komponente still auf den Paketnamen zurück, der gemergte Release-PR wird
  nicht getaggt, und jeder folgende Release ist blockiert. Die Version steht
  in der Root-`package.json` und wird über `extra-files` in die
  Workspace-Manifeste kopiert.
- **Der Merge des Release-PRs** (mit PO-Approval wie jeder PR) ist das einzige
  Release-Ereignis: Tag `vX.Y.Z`, GitHub-Release, `CHANGELOG.md` und das Image.
  Manuell wird nie getaggt, und `CHANGELOG.md` und
  `.release-please-manifest.json` werden nie von Hand editiert.
- **CI-Gate:** `require-green-ci` löst den Tag zum Commit auf, sucht dessen
  `ci`-Push-Run und wartet mit `gh run watch --exit-status`. Ein fehlender
  Lauf ist kein bestandener Lauf — dann wird nichts veröffentlicht.
  release-please selbst ist nicht gegated.
- **`publish-image`** baut mit Checkout **am Tag** (nicht am Branch-Head) und
  pusht `ghcr.io/jocur/grimoire` mit dem Versions-Tag und `:latest`.
  `:latest` heißt „letzter Release", nicht „letzter Merge". Das Compose-File
  referenziert `${GRIMOIRE_VERSION:-latest}`; empfohlen ist eine
  festgenagelte Version.
- **Die Build-Id** `GRIMOIRE_BUILD` brennt das Release-Image als Tag ein —
  derselbe Wert in Bundle und Server, damit der Reload-Banner nur bei einem
  echten Versionswechsel erscheint (`decisions/polling`).
- Der PO pullt selbst einen Versions-Tag; Rollback ist ein älterer
  Versions-Tag.
- Nicht dabei: Multi-Arch (`linux/amd64` genügt) und Auto-Deploy.

### CI baut zur Prüfung, publiziert nie

**Der Release-Workflow ist der einzige Schreiber der GHCR-Registry;**
`.github/workflows/ci.yml` pusht kein Image. Es hat aber einen Job
`image-build` (`docker/build-push-action` mit `push: false`, ohne
Registry-Login und ohne `packages: write` — er kann nicht publizieren). Er
läuft auf PRs und main-Pushes, hängt nur an `test` und nutzt denselben
GHA-Cache wie der Release-Build. `GRIMOIRE_BUILD` bekommt dort den Commit-SHA
als Wegwerf-Wert.

## Warum

Der PO will gezielt einen bekannten guten Stand vor einer Session deployen und
im Problemfall trivial zurückrollen. Ein Tag, das bei jedem Merge unter dem
laufenden Betrieb mutiert, verhindert beides. Ein SHA-Push bei jedem Merge
hielte das Paket dauerhaft „gerade aktualisiert" und verwässerte die
Release-Semantik; zu einem Versions-Tag gehört ein Changelog, zu einem SHA
nicht.

release-please bleibt ungegated, weil der Release-PR auch bei rotem `main`
gepflegt werden muss: er ist das Werkzeug, mit dem der Zustand gelesen und
repariert wird.

Der Prüf-Build in CI lässt einen Fehler im Dockerfile im Review auffallen und
nicht erst im Release-Lauf, wo der Tag schon existiert; der Release-Build
findet den Cache zusätzlich warm vor. Ein paar Runner-Minuten pro PR sind
billiger als ein Patch-Release, das nur ein kaputtes Image repariert.

## Folgen

- CI prüft, Release publiziert.
- Die Deploy-Schritte stehen in [docs/DEPLOYMENT.md](../DEPLOYMENT.md).
