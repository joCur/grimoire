// Grimoire-Server — Grundgerüst.
// Läuft mit Bun (bun run src/server.ts) oder Node >= 20 mit tsx.
// Bewusst ohne Framework-Magie: die API ist klein genug für Handarbeit.

import { createProvider } from "./llm-provider";

const CAMPAIGN_ROOT = process.env.CAMPAIGN_ROOT ?? "../campaigns";
const PORT = Number(process.env.PORT ?? 3000);

// Geplante API (Konventionen siehe /README.md):
//
//   GET  /api/campaigns                       Kampagnen-Liste (Ordner)
//   GET  /api/:campaign/tree                  Szenen/NPCs/Orte als Baum (Frontmatter geparst)
//   GET  /api/:campaign/file?path=...         eine Datei (roh + geparst + mtime)
//   PATCH /api/:campaign/frontmatter          { path, mtime, patch } — nur bei
//                                             unverändertem mtime, sonst 409
//   POST /api/:campaign/session/start         legt sessions/<heute>.md an
//   POST /api/:campaign/session/end           setzt `ended`
//   POST /api/:campaign/log                   { text, sceneId? } → append mit Zeitstempel
//   POST /api/:campaign/inbox                 { text } → append an inbox.md
//   POST /api/:campaign/generate              { chapter, sourceText } → GenerateResult
//                                             (Review-Vorschau; schreibt NICHTS)
//   POST /api/:campaign/generate/apply        { scenes, stubs } → schreibt Drafts
//
// Validierung nach generate: Frontmatter parsebar, status==draft,
// Referenzen existieren oder liegen als Stub bei, nur bekannte Callouts.
// Fehler → Korrektur-Turn ans LLM (max. 2), siehe generator/README.md.

const provider = createProvider(process.env);
console.log(
  `Grimoire server (stub) — provider: ${provider.name}, campaigns: ${CAMPAIGN_ROOT}, port: ${PORT}`,
);
console.log("Endpoints sind oben dokumentiert und noch zu implementieren.");
