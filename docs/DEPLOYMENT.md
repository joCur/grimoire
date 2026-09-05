# Grimoire — Deployment & Betrieb

Ein Container, ein Prozess: der Hono-Server liefert `/api` **und** den
gebauten Frontend-Bundle aus `app/dist`. Die Kampagnendaten liegen außerhalb
des Images in einem Volume. Zugriffsschutz ist Deployment-Sache, nicht
App-Sache — Standard ist Tailscale (siehe DECISIONS #3 und #5).

> **Seit der SQLite-Umstellung (ADR #13):** die Kampagnen-Wahrheit ist **eine
> SQLite-Datei** — `GRIMOIRE_DATA/grimoire.db`, Default `/data` im Container.
> `CAMPAIGN_ROOT` ist nur noch die **Quelle der Erstmigration**: beim ersten
> Start mit leerer Datenbank werden die Markdown-Kampagnen einmal übernommen,
> danach fasst der Server den Ordner nie wieder an. Zu sichern ist damit das
> `GRIMOIRE_DATA`-Volume — Abschnitt 2a.

## 1. Bauen und starten

> Am schnellsten: die `docker-compose.yml` im Repo-Root auf den Server
> kopieren, `.env` mit `OPENROUTER_API_KEY=…` (und optional
> `GRIMOIRE_VERSION=v0.1.0`) daneben legen, `docker compose up -d`.
> Versionswahl, Update und Rollback: Abschnitt 1a. Alles Folgende ist der
> manuelle Weg.


```bash
docker build -t grimoire .

docker run -d --name grimoire \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v /srv/grimoire/data:/data \
  -v /srv/grimoire/campaigns:/campaigns \
  -e ANTHROPIC_API_KEY=sk-ant-… \
  grimoire
```

- `-p 127.0.0.1:3000:3000` bindet den Port bewusst nur auf Loopback; nach
  außen geht es über Tailscale (Abschnitt 3).
- `/data` ist der **Zustand**: dort liegt `grimoire.db` (plus `-wal`/`-shm`).
  Das ist das Volume, das gesichert wird (Abschnitt 2a).
- `/campaigns` enthält **direkt die Kampagnen-Ordner**, also
  `/campaigns/<kampagne>/…` — dieselbe Struktur wie `examples/` (README.md).
  Es wird **nur beim ersten Start** gelesen (Erstmigration, Abschnitt 2b) und
  danach nie wieder; nach der Migration kann der Mount auch wegfallen.
- Schreibrechte: der Container läuft als `uid 1000` (`bun`). Bei einem
  Bind-Mount einmalig `sudo chown -R 1000:1000 /srv/grimoire/data`, sonst
  kann die Datenbank nicht angelegt werden. `/campaigns` braucht nur
  **Leserechte**.

**Ohne Volume** startet der Container nicht leer: das Image bringt
`examples/` als Demo-Kampagne unter `/campaigns` mit, die beim ersten Start in
eine (dann container-interne, flüchtige) Datenbank übernommen wird.
Praktisch für einen Smoke-Test:

```bash
docker run --rm -p 3000:3000 grimoire   # zeigt die Beispielkampagne
```

**Update:** neu bauen, Container ersetzen (`docker rm -f grimoire` + `run`).
Der Container selbst hat keinen Zustand — der steht im `/data`-Volume, und
ein Start auf einer schon migrierten Datenbank ist ein No-op.

### Alternative: fertiges Image aus GHCR ziehen

Das Produktivsystem muss nicht selbst bauen — Images liegen in der GitHub
Container Registry. Der Release-Workflow ist der **einzige** Schreiber dieser
Registry — ein main-Merge veröffentlicht nichts (Issues #47/#66,
DECISIONS #12). Es gibt daher genau zwei Tag-Sorten:

| Tag | Woher | Wofür |
| --- | ----- | ----- |
| `v0.1.0` (auch `0.1.0`) | Release-Workflow beim Merge des Release-PRs | **das, worauf ein Produktivsystem festnagelt** |
| `latest` | derselbe Release-Workflow | jeweils letzter Release — mutiert **nicht** bei main-Merges |

Einen noch nicht releasten Stand gibt es nicht als Image: dafür baut man
lokal (Abschnitt 1).

```bash
docker pull ghcr.io/jocur/grimoire:v0.1.0

docker run -d --name grimoire \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v /srv/grimoire/campaigns:/campaigns \
  --env-file /srv/grimoire/.env \
  ghcr.io/jocur/grimoire:v0.1.0
```

Das Package ist bei GHCR standardmäßig **privat**, ein `docker pull` ohne
Anmeldung schlägt deshalb zunächst fehl. Zwei Wege:

- **Öffentlich schalten** (einmalig, einfachster Weg): GitHub → Packages →
  `grimoire` → Package settings → Change visibility → `public`. Danach zieht
  jeder Host ohne Login. Das Image enthält nur Code und die Beispielkampagne,
  keine Kampagnendaten und keine Secrets (`.dockerignore`).
- **Privat lassen** und auf dem Host einmal anmelden, mit einem Personal
  Access Token (classic) mit dem Scope `read:packages`:

  ```bash
  echo <PAT> | docker login ghcr.io -u jocur --password-stdin
  ```

## 1a. Versionswahl, Update, Rollback

Releases entstehen nicht automatisch bei jedem Merge: release-please hält aus
den Conventional Commits auf `main` einen Release-PR („chore(main): release
X.Y.Z"). Erst dessen Merge (mit PO-Approval wie jeder PR) erzeugt Tag
`vX.Y.Z`, GitHub-Release mit Changelog **und** die Image-Tags oben — und nur
dann, wenn der `ci`-Lauf genau dieses Commits grün war (`require-green-ci` in
`.github/workflows/release.yml`).

Das Compose-File referenziert deshalb
`ghcr.io/jocur/grimoire:${GRIMOIRE_VERSION:-latest}`. Empfehlung für den
Produktivbetrieb: in `.env` eine Version festnageln.

```bash
# /srv/grimoire/.env
GRIMOIRE_VERSION=v0.1.0
```

**Update** (bewusst, nie direkt vor einer Session):

```bash
# 1. Changelog des neuen Releases lesen (GitHub → Releases)
# 2. GRIMOIRE_VERSION in .env auf den neuen Tag setzen
docker compose pull
docker compose up -d
```

Ohne `GRIMOIRE_VERSION` zieht `docker compose pull` den jeweils letzten
Release über `latest` — bequem, aber man weiß hinterher nicht, welcher Stand
läuft. Welcher es war, sagt notfalls
`docker inspect --format '{{index .Config.Env}}' grimoire | tr ' ' '\n' | grep GRIMOIRE_BUILD`
(Build-Id = Release-Tag).

**Rollback** ist derselbe Handgriff rückwärts — kein Zustand im Container,
alles steht im Volume:

```bash
# GRIMOIRE_VERSION zurück auf den letzten guten Tag
docker compose up -d
```

Manuell (ohne Compose): `docker rm -f grimoire`, dann derselbe `docker run`
wie oben mit `ghcr.io/jocur/grimoire:<alter-versions-tag>`. Versions-Tags sind
die einzige Rollback-Referenz — zu ihnen gehört ein Changelog, und alte
Releases bleiben in GHCR liegen.

## 2. Konfiguration (Env-Variablen)

| Variable            | Default      | Bedeutung                                                     |
| ------------------- | ------------ | ------------------------------------------------------------- |
| `GRIMOIRE_DATA`     | `/data` (im Image; sonst `./data` neben dem `server/`-Paket) | Verzeichnis der SQLite-Datenbank `grimoire.db` — **der Zustand des Deployments** (Abschnitt 2a) |
| `CAMPAIGN_ROOT`     | `/campaigns` | Ordner mit den Markdown-Kampagnen. Nur **Quelle der Erstmigration** (Abschnitt 2b) — im laufenden Betrieb ungenutzt |
| `PORT`              | `3000`       | HTTP-Port im Container                                        |
| `APP_DIST`          | `../app/dist` (relativ zum `server/`-Paket) | Pfad des Frontend-Builds; im Image bereits richtig |
| `GRIMOIRE_BUILD`    | `dev`        | Build-Id; als Build-Arg in Bundle **und** Server eingebrannt — bei GHCR-Images der Release-Tag (`v0.1.0`), bei lokalen Builds das, was man als `--build-arg` mitgibt (sonst `dev`) |
| `GRIMOIRE_VERSION`  | `latest`     | **nur im Compose-File**, kein App-Setting: der Image-Tag, den `docker compose` zieht (Abschnitt 1a) |

## 2a. Datenbank, Volume und Sicherung

Die gesamte Kampagnen-Wahrheit ist **eine Datei**:

```
$GRIMOIRE_DATA/
  grimoire.db        ← Kampagnen, Szenen, NPCs, Orte, Sessions, Log,
  grimoire.db-wal      Inbox, Glossar, Generator-Jobs, Suchindex
  grimoire.db-shm
```

- `-wal` und `-shm` **gehören zum Datenbestand**. Wer nur `grimoire.db`
  kopiert, während der Server läuft, kopiert einen unvollständigen Stand.
- Schema-Migrationen laufen beim Start automatisch (in einer Transaktion,
  Buchführung in `__drizzle_migrations`). Ein **Downgrade** wird nicht
  unterstützt: der Rückweg bei Problemen ist die eigene Volume-Sicherung plus
  Image-Rollback auf den alten Tag (DECISIONS #12).
- **WAL auf Bind-Mounts:** WAL braucht funktionierendes `mmap`/Locking im
  gemounteten Dateisystem. Lokale Bind-Mounts und Docker-Volumes sind
  unproblematisch; **Netzwerk-Dateisysteme (NFS, SMB/CIFS) sind es nicht** —
  dort gehört die Datenbank auf lokalen Speicher, nicht auf die Freigabe.

### Sicherung — Sache des Stack-Owners

Grimoire hat **bewusst kein eigenes Backup-System** (Planung #52, F3): kein
`grimoire backup`, keine Auto-Backups vor Migrations-Boots. Es gibt eine
Datei in einem Volume, und die sichert der Betreiber mit seinen Bordmitteln.
Zwei Wege, die konsistent sind:

```bash
# a) im Betrieb, ohne Downtime — ein konsistenter Einzeldatei-Snapshot:
sqlite3 /srv/grimoire/data/grimoire.db "VACUUM INTO '/backup/grimoire-$(date +%F).db'"

# b) oder Container stoppen und das Verzeichnis komplett sichern:
docker compose stop
tar czf /backup/grimoire-$(date +%F).tar.gz -C /srv/grimoire data
docker compose start
```

Ein `cp grimoire.db` im laufenden Betrieb ist **kein** Backup — nimm `VACUUM
INTO` oder stoppe den Container. Der Wiederherstellungsweg ist derselbe
rückwärts: Container stoppen, Datei(en) zurücklegen, Container starten.

Zusätzliche Beruhigung für den Umstieg: der ursprüngliche Markdown-Baum wird
von der Migration **nie gelöscht, verschoben oder markiert** — er bleibt als
lesbarer Vor-Migrations-Stand liegen (Planung #52, F-neu-1).

## 2b. Erstmigration (Markdown → Datenbank)

Beim Start prüft der Server die Datenbank und migriert **nur dann**, wenn sie
noch leer bzw. unmarkiert ist:

1. Datenbank öffnen/anlegen, Schema-Migrationen laufen lassen.
2. Ist `meta['migrated_at']` gesetzt **oder** enthält die Datenbank schon
   Kampagnen? → fertig, `CAMPAIGN_ROOT` wird gar nicht gelesen.
3. Sonst: jede Kampagne aus `CAMPAIGN_ROOT` übernehmen — **eine Transaktion
   pro Kampagne**, also entweder vollständig oder nicht. Ein Lauf, der
   zwischen zwei Kampagnen abbricht, wird beim nächsten Start fortgesetzt.

Was der Importer nicht in Zeilen übersetzen konnte, geht **nicht verloren**:
die Datei liegt wörtlich in `unknown_files`, und für jeden Vorfall gibt es
eine Zeile in `migration_report` — abrufbar über
`GET /api/<kampagne>/migration-report` und in der App als leiser,
zugeklappter Hinweis auf der Kampagnenseite. **Ein leerer Report ist das
Erfolgskriterium eines saubereren Imports.**

**Empfohlener Ablauf für eine echte Kampagne** (Planung #52, Risiko R3):

```bash
# 1. Probelauf auf einer KOPIE, in ein leeres Datenverzeichnis:
mkdir -p /tmp/grimoire-probe
docker run --rm \
  -v /tmp/grimoire-probe:/data \
  -v /srv/grimoire/campaigns:/campaigns:ro \
  ghcr.io/jocur/grimoire:v0.1.0 \
  bun run server/src/cli.ts seed /campaigns

# 2. Report lesen — der seed-Befehl druckt jede Degradation dieses Laufs.
#    Nichts? Dann ist der Import sauber.
# 3. Erst danach den echten Container mit dem echten /data-Volume starten.
```

`grimoire seed [dir]` führt **denselben** Migrationscode aus wie der Boot —
es gibt keinen zweiten Importer, der auseinanderlaufen könnte. Auch er
überschreibt nie: eine Datenbank mit Inhalt bleibt unangetastet (`--force`
existiert nur für Wegwerf-Datenbanken).

**Nach der Migration** ist `CAMPAIGN_ROOT` überflüssig. Der Mount kann
bleiben (kostet nichts, ist der Vor-Migrations-Stand) oder wegfallen — der
Server liest ihn nicht mehr.

### Generator (LLM-Provider)

Alles hier ist **optional** — ohne Konfiguration läuft alles außer dem
Generator. `LLM_PROVIDER` wählt den Provider, die übrigen Variablen gelten
jeweils nur für den gewählten:

| Variable             | Gilt für     | Default                        | Bedeutung                                             |
| -------------------- | ------------ | ------------------------------ | ----------------------------------------------------- |
| `LLM_PROVIDER`       | –            | `claude`                       | `claude`, `openrouter`, `openai`, `lmstudio`           |
| `ANTHROPIC_API_KEY`  | `claude`     | –                              | **erforderlich** für `claude`                          |
| `CLAUDE_MODEL`       | `claude`     | `claude-sonnet-4-6`            | Modell-Override                                        |
| `OPENROUTER_API_KEY` | `openrouter` | –                              | **erforderlich** für `openrouter`                      |
| `LLM_MODEL`          | `openrouter`, `openai` | –                    | **erforderlich**, z. B. `anthropic/claude-sonnet-4.6`  |
| `LLM_BASE_URL`       | `openai` (Pflicht), `openrouter` (Override) | `https://openrouter.ai/api/v1` | API-Root eines OpenAI-kompatiblen Endpoints, **ohne** `/chat/completions` |
| `LLM_API_KEY`        | `openai`     | –                              | optional, nur wenn der Endpoint Auth verlangt          |
| `LMSTUDIO_URL`       | `lmstudio`   | `http://localhost:1234/v1`     | API-Root der lokalen LM-Studio-Instanz                 |
| `LMSTUDIO_MODEL`     | `lmstudio`   | `local-model`                  | Modellname in LM Studio                                |
| `LLM_MAX_TOKENS`     | alle         | `8000` (`claude`), sonst Endpoint-Default | Obergrenze der Antwortlänge (positive Ganzzahl; unbrauchbare Werte werden ignoriert) |
| `LLM_CORRECTION_TURNS` | alle       | `1`                            | Korrektur-Turns nach dem ersten Aufruf (`0`–`2`; unbrauchbare Werte werden ignoriert) |
| `LLM_FORCE_JSON`     | `openrouter`, `openai`, `lmstudio` | an              | Sendet `response_format: {"type":"json_object"}` mit; `0` = aus, für Endpoints/Modelle ohne `response_format`-Unterstützung (der `claude`-Pfad erzwingt JSON per Assistant-Prefill und ist davon unberührt) |

`LLM_MAX_TOKENS` lohnt sich beim Modellvergleich: schneidet ein Modell die
JSON-Antwort ab, erkennt der Generator das an `finish_reason`/`stop_reason`
und bricht sofort mit `422` und der Meldung „Antwort wurde vom Modell
abgeschnitten — LLM_MAX_TOKENS erhöhen (aktuell: …) oder Quelltext
verkleinern" ab, statt zwei teure Korrektur-Turns zu drehen; dann das Limit
erhöhen oder den Quelltext verkleinern.

`LLM_CORRECTION_TURNS` regelt, wie oft eine fehlgeschlagene Formprüfung als
Fehlerliste ans Modell zurückgeht (Default `1`): die nicht heilbaren Auslöser
sind weg (abgeschnittene Antworten brechen sofort ab, Prosa um das JSON wird
toleriert), und was übrig bleibt, repariert ein Modell mit Fehlerliste fast
immer im ersten Turn — ein zweiter kostet nur. `0` schaltet Korrektur-Turns
ganz ab (billigster, strengster Modus), `2` ist das Maximum.

**Generierungen laufen im Hintergrund** (Issue #19): `POST
/api/:campaign/generate` startet einen Job und antwortet mit `202
{"jobId":…}`; das Ergebnis holt die App über `GET
/api/:campaign/generate/job`. Ein Job pro Kampagne (zweiter Start → `409`
mit der laufenden `jobId`), und er bleibt inklusive Review-Edits liegen, bis
er übernommen oder verworfen wird — Navigation, Reload oder ein geschlossener
Tab kosten damit keine Generierung mehr. Die Jobs liegen **nur im
Arbeitsspeicher**: ein Container-Neustart verliert einen laufenden Job
(bewusst — auf der Platte bleiben die Kampagnendateien die einzige Wahrheit).
Die App meldet das dann im Generator als „Der Generierungs-Job ist nicht mehr
vorhanden (Server-Neustart?)".

Fehlt eine erforderliche Variable, antwortet nur `POST
/api/:campaign/generate` mit `503` und der Meldung im Klartext, z. B.
`{"error":"ANTHROPIC_API_KEY fehlt"}`, `{"error":"OPENROUTER_API_KEY fehlt"}`
oder `{"error":"LLM_MODEL fehlt (z. B. anthropic/claude-sonnet-4.6)"}` (der
Provider wird bewusst erst pro Request erzeugt). Ein Tippfehler in
`LLM_PROVIDER` fällt genauso auf statt still auf Claude zurückzufallen:
`{"error":"Unbekannter LLM_PROVIDER: …"}`. Lese- und Schreib-API sind von
all dem nicht betroffen.

**Beispiel OpenRouter** (ein Key, viele Modelle — praktisch zum Vergleichen):

```bash
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-…
LLM_MODEL=anthropic/claude-sonnet-4.6
```

Modellwechsel = `LLM_MODEL` ändern und Container neu starten. Grimoire
schickt dabei OpenRouters optionale Attributions-Header (`HTTP-Referer`,
`X-Title`) mit; das ist reine Kennzeichnung in deren Dashboard.

**Beispiel LM Studio** (lokal, ohne Key — der Container muss den Host
erreichen, unter Docker Desktop z. B. `http://host.docker.internal:1234/v1`):

```bash
LLM_PROVIDER=lmstudio
LMSTUDIO_URL=http://host.docker.internal:1234/v1
LMSTUDIO_MODEL=qwen2.5-32b-instruct
```

`LLM_PROVIDER=openai` ist derselbe Transport für jeden anderen
OpenAI-kompatiblen Endpoint (vLLM, Ollama, LiteLLM, Azure-Proxy, …):
`LLM_BASE_URL` + `LLM_MODEL`, `LLM_API_KEY` nur falls nötig.

Secrets nicht ins Image: `.env` ist gitignored **und** in `.dockerignore`.
Zur Laufzeit übergeben:

```bash
docker run --env-file /srv/grimoire/.env … grimoire
```

## 3. Erreichbarkeit: Tailscale zuerst

Grimoire hat kein Login (DECISIONS #3). Es darf deshalb **nicht** offen im
Internet stehen. Zwei erprobte Muster:

**A) Tailscale auf dem Host (einfachster Weg)**

```bash
tailscale serve --bg --https=443 http://127.0.0.1:3000
tailscale serve status
```

Erreichbar ist die App dann per MagicDNS unter
`https://<hostname>.<tailnet>.ts.net` — TLS-Zertifikat besorgt Tailscale
selbst. Container-Port dabei auf `127.0.0.1` binden (Abschnitt 1).
Kein `tailscale funnel`, das würde den Dienst öffentlich machen.

**B) Tailscale als Sidecar-Container**

Für Hosts ohne Tailscale-Installation: ein `tailscale/tailscale`-Container
mit `TS_AUTHKEY` (Auth-Key aus der Tailscale-Admin-Konsole) und
`TS_SERVE_CONFIG` für HTTPS; Grimoire teilt dessen Netzwerk-Namespace
(`--network=container:tailscale`, in Compose `network_mode:
service:tailscale`). Dann veröffentlicht Grimoire selbst keinen Port nach
außen. Zustand des Sidecars (`/var/lib/tailscale`) in ein Volume legen,
sonst muss nach jedem Neustart neu authentifiziert werden.

**Alternativen** (falls Tailscale nicht in Frage kommt, DECISIONS #3/#7):
Reverse Proxy davor — Caddy/nginx/Traefik mit Basic Auth für den
Minimalfall, oder Forward Auth gegen Authelia/authentik, wenn echte Sessions
und 2FA gewünscht sind. In beiden Fällen bleibt der App-Code unverändert;
kein In-App-Auth nachbauen.

## 4. Backup

**Gesichert wird das `GRIMOIRE_DATA`-Volume — siehe Abschnitt 2a**, dort steht
das Verfahren (`VACUUM INTO` im Betrieb, oder Container stoppen und das
Verzeichnis kopieren) und die Wiederherstellung.

Was hier früher stand, galt für die Markdown-Ära: „Backup ist Dateikopie",
Git-Historie pro Szene, `rsync` über `campaigns/`. Seit ADR #13 ist das nicht
mehr die Sicherung, sondern höchstens ein Archiv des Vor-Migrations-Stands —
`campaigns/` wird nach der Erstmigration nicht mehr beschrieben und nicht mehr
gelesen. Wer diesen Ordner weiter versioniert, sichert damit **keine** laufende
Kampagne.

## 5. Betrieb & Fehlersuche

- Logs: `docker logs -f grimoire`. Beim Start erscheinen der Pfad der
  Datenbank, der Port, eine Zeile zur Erstmigration (bzw. „no import needed …
  CAMPAIGN_ROOT is not read") und `Serving app build from /app/app/dist`. Steht dort
  stattdessen `No app build at …`, fehlt `app/dist` im Image (Build-Stage
  fehlgeschlagen) und der Container liefert nur die API.
- Healthcheck: eingebaut (`GET /api/campaigns`), sichtbar über
  `docker inspect --format '{{.State.Health.Status}}' grimoire`.
- Aktualisierung im Browser: jeder Write zählt `campaigns.version` in
  derselben Transaktion hoch, die App pollt `GET /api/:campaign/version`
  (DECISIONS #9). Es gibt keinen Datei-Watcher mehr — Edits im Dateibaum
  wirken NICHT, die Datenbank ist die Wahrheit (ADR #13).
- Generator-Jobs überleben einen Neustart (ADR #10-Nachtrag): ein fertiger
  Job ist nach dem Boot noch da und übernehmbar. War ein Job im Lauf, steht im
  Log `N generate job(s) were running at the last shutdown — marked as
  failed`, und die App zeigt „Server wurde während des Laufs neu gestartet —
  Job neu starten". Das ist die erwartete Meldung, kein Defekt.
- Banner „Neue Version verfügbar — neu laden": ein offener Tab läuft noch mit
  einem älteren Bundle als der Server (Build-Ids aus `GRIMOIRE_BUILD` weichen
  ab, Vergleich beim laufenden Versions-Polling) — der Klick lädt hart neu,
  automatisch passiert bewusst nichts. Lokal und in selbst gebauten Images
  ohne `--build-arg GRIMOIRE_BUILD=…` steht auf beiden Seiten `dev`, dann
  bleibt das Banner immer aus.
- Caching: `/assets/*` (gehashte Dateinamen) wird `immutable` ausgeliefert,
  `index.html` mit `no-cache`. Ein Deploy ist damit sofort sichtbar, ohne
  dass der Browser Bundles doppelt lädt.
- Entwicklung ist davon unberührt: dort läuft der Vite-Dev-Server und proxied
  `/api` auf `localhost:3000` (`app/vite.config.ts`); ohne `app/dist` serviert
  der Server nichts Statisches.
- Runtime-Wechsel bleibt offen (DECISIONS #7): server/ und shared/ liegen als
  TypeScript-Quelle im Image, es werden keine Bun-only-Laufzeit-APIs benutzt.
  Ein Node-Image mit `@hono/node-server` wäre ein Deployment-Umbau, kein
  Code-Umbau.
