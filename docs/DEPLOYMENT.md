# Grimoire — Deployment & Betrieb

Ein Container, ein Prozess: der Hono-Server liefert `/api` **und** den
gebauten Frontend-Bundle aus `app/dist`. Kampagnendaten liegen außerhalb des
Images in einem Volume. Zugriffsschutz ist Deployment-Sache, nicht App-Sache
— Standard ist Tailscale (siehe DECISIONS #3 und #5).

## 1. Bauen und starten

> Am schnellsten: die `docker-compose.yml` im Repo-Root auf den Server
> kopieren, `.env` mit `OPENROUTER_API_KEY=…` daneben legen,
> `docker compose up -d`. Alles Folgende ist der manuelle Weg.


```bash
docker build -t grimoire .

docker run -d --name grimoire \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v /srv/grimoire/campaigns:/campaigns \
  -e ANTHROPIC_API_KEY=sk-ant-… \
  grimoire
```

- `-p 127.0.0.1:3000:3000` bindet den Port bewusst nur auf Loopback; nach
  außen geht es über Tailscale (Abschnitt 3).
- Das Volume enthält **direkt die Kampagnen-Ordner**, also
  `/campaigns/<kampagne>/…` — dieselbe Struktur wie `examples/` (README.md).
- Schreibrechte: der Container läuft als `uid 1000` (`bun`). Bei einem
  Bind-Mount einmalig `sudo chown -R 1000:1000 /srv/grimoire/campaigns`,
  sonst schlagen Session-Log, Inbox und Generator-Drafts fehl.

**Ohne Volume** startet der Container nicht leer: das Image bringt
`examples/` als Demo-Kampagne unter `/campaigns` mit. Ein gemountetes Volume
überdeckt sie einfach — die Demo-Dateien bleiben im Image und sind dann nicht
sichtbar. Praktisch für einen Smoke-Test:

```bash
docker run --rm -p 3000:3000 grimoire   # zeigt die Beispielkampagne
```

**Update:** neu bauen, Container ersetzen (`docker rm -f grimoire` + `run`).
Es gibt keinen Zustand im Container — alles steht im Volume.

### Alternative: fertiges Image aus GHCR ziehen

Die CI-Pipeline (`.github/workflows/ci.yml`) baut bei jedem Push auf `main`
dasselbe Dockerfile und pusht das Ergebnis in die GitHub Container Registry —
getaggt mit `latest` und mit dem Commit-SHA. Das Produktivsystem muss dann
nicht mehr selbst bauen:

```bash
docker pull ghcr.io/jocur/grimoire:latest
# oder festgenagelt auf einen Commit (empfohlen für Rollbacks):
docker pull ghcr.io/jocur/grimoire:<commit-sha>

docker run -d --name grimoire \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v /srv/grimoire/campaigns:/campaigns \
  --env-file /srv/grimoire/.env \
  ghcr.io/jocur/grimoire:latest
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

**Update** in dieser Variante: `docker pull …:latest`, dann Container
ersetzen (`docker rm -f grimoire` + `run`). Rollback = derselbe `run` mit dem
SHA-Tag des vorherigen Commits.

## 2. Konfiguration (Env-Variablen)

| Variable            | Default      | Bedeutung                                                     |
| ------------------- | ------------ | ------------------------------------------------------------- |
| `CAMPAIGN_ROOT`     | `/campaigns` | Ordner mit den Kampagnen-Verzeichnissen (im Image gesetzt)     |
| `PORT`              | `3000`       | HTTP-Port im Container                                        |
| `APP_DIST`          | `../app/dist` (relativ zum `server/`-Paket) | Pfad des Frontend-Builds; im Image bereits richtig |

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

`LLM_MAX_TOKENS` lohnt sich beim Modellvergleich: schneidet ein Modell die
JSON-Antwort ab, erkennt der Generator das an `finish_reason`/`stop_reason`
und bricht sofort mit `422` und der Meldung „Antwort wurde vom Modell
abgeschnitten — LLM_MAX_TOKENS erhöhen (aktuell: …) oder Quelltext
verkleinern" ab, statt zwei teure Korrektur-Turns zu drehen; dann das Limit
erhöhen oder den Quelltext verkleinern.

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

`campaigns/` sind reine Markdown-Dateien — Backup ist Dateikopie, kein Dump:

- **Git** (empfohlen): Kampagnen-Ordner ist ein Repo, `git add -A && git
  commit` per Cron oder nach der Session. Nebeneffekt: Historie und Diff für
  jede Szene.
- **rsync/restic** auf einen anderen Host bzw. Storage.

Die Schreibzugriffe der App sind klein und append-orientiert (DECISIONS #4),
ein Snapshot im laufenden Betrieb ist unkritisch. Wiederherstellung =
Dateien zurückkopieren, Container neu starten (der Watcher liest neu ein).

## 5. Betrieb & Fehlersuche

- Logs: `docker logs -f grimoire`. Beim Start erscheinen der Kampagnen-Pfad,
  der Port und `Serving app build from /app/app/dist`. Steht dort
  stattdessen `No app build at …`, fehlt `app/dist` im Image (Build-Stage
  fehlgeschlagen) und der Container liefert nur die API.
- Healthcheck: eingebaut (`GET /api/campaigns`), sichtbar über
  `docker inspect --format '{{.State.Health.Status}}' grimoire`.
- Externe Edits (VS Code Remote, `git pull`) erkennt der chokidar-Watcher und
  erhöht den Versionszähler; die App pollt `GET /api/:campaign/version`
  (DECISIONS #9). Auf exotischen Mounts (NFS, manche FUSE-Setups) kommen
  keine Datei-Events an — dann hilft nur ein Reload im Browser bzw. ein
  Container-Neustart.
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
