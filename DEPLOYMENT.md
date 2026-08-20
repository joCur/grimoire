# Grimoire — Deployment & Betrieb

Ein Container, ein Prozess: der Hono-Server liefert `/api` **und** den
gebauten Frontend-Bundle aus `app/dist`. Kampagnendaten liegen außerhalb des
Images in einem Volume. Zugriffsschutz ist Deployment-Sache, nicht App-Sache
— Standard ist Tailscale (siehe DECISIONS #3 und #5).

## 1. Bauen und starten

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

## 2. Konfiguration (Env-Variablen)

| Variable            | Default      | Bedeutung                                                     |
| ------------------- | ------------ | ------------------------------------------------------------- |
| `CAMPAIGN_ROOT`     | `/campaigns` | Ordner mit den Kampagnen-Verzeichnissen (im Image gesetzt)     |
| `PORT`              | `3000`       | HTTP-Port im Container                                        |
| `APP_DIST`          | `../app/dist` (relativ zum `server/`-Paket) | Pfad des Frontend-Builds; im Image bereits richtig |
| `ANTHROPIC_API_KEY` | –            | **optional**, nur für den Generator                            |
| `CLAUDE_MODEL`      | Provider-Default | optional, Modell-Override für den Generator                |

Ohne `ANTHROPIC_API_KEY` läuft alles außer dem Generator: `POST
/api/:campaign/generate` antwortet dann `503 {"error":"ANTHROPIC_API_KEY
fehlt"}` (der Provider wird bewusst erst pro Request erzeugt). Lese- und
Schreib-API sind davon nicht betroffen.

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
