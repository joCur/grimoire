# Generator

Pipeline: Quelltext (EN) → LLM → Szenen-Drafts (DE) → Review-Vorschau → Platte.

## Ablauf pro Aufruf

1. Server sammelt Kontext: alle npc-/location-ids + Namen, Kapitel-id,
   `glossary.md`.
2. Prompt = `system-prompt.md` + `example-output.md` (Few-Shot-Ziel)
   + Kontext + Quelltext.
3. LLM antwortet mit JSON (Schema siehe system-prompt.md).
4. Server validiert mechanisch:
   - Frontmatter-Block parsebar? `type`/`status` gültig? `status == draft`?
     Stubs: NPC-Status gültig (Normalfall `alive`), Orte ohne status-Key.
   - alle `npcs`-/`location`-Referenzen existieren ODER liegen als Stub bei?
   - nur bekannte Callout-Typen?
   Fehler gehen als Korrektur-Turn zurück ans LLM (konfigurierbar
   über LLM_CORRECTION_TURNS, 0–2, Default 1),
   nicht an den Nutzer. Ausnahme: eine vom Modell abgeschnittene Antwort
   (finish_reason/stop_reason) bricht sofort ab — Korrektur-Turns können
   ein Token-Limit nicht heilen, sie kosten nur.
5. App zeigt Review-Vorschau: Szenen editierbar, Stubs einzeln
   annehmen/ablehnen. Erst „Übernehmen" schreibt auf die Platte.

## NPC-Generator

Gleiche Pipeline, eigener Endpoint (`POST /api/:campaign/generate/npc`)
und eigene Prompt-Assets (`npc-system-prompt.md`, `npc-example-output.md`
— Few-Shot ist die Format-Referenz `examples/beispiel/npcs/fenn.md`).
Zielformat: NPC-Entität aus README.md; Beziehungen nur auf existierende
ids, Quickstats als gequotete Strings (das Plus überlebt YAML),
status alive als Normalfall. Ein Generator-Job pro Kampagne, egal ob
Szenen oder NPC.

## Provider

Abstraktion in `server/src/llm-provider.ts`, Auswahl per Env-Var
`LLM_PROVIDER` — keine Code-Änderung nötig:

- `claude` (Default): Claude API direkt (`ANTHROPIC_API_KEY`, optional
  `CLAUDE_MODEL`).
- `openrouter`: OpenRouter als Modell-Router (`OPENROUTER_API_KEY` +
  `LLM_MODEL`, z. B. `anthropic/claude-sonnet-4.6`) — ein Key, viele
  Modelle, damit lässt sich vergleichen, ohne die Konfiguration umzubauen.
- `openai`: derselbe Transport für **jeden** OpenAI-kompatiblen Endpoint
  (`LLM_BASE_URL` + `LLM_MODEL`, `LLM_API_KEY` nur falls verlangt).
- `lmstudio`: lokal ohne Key (`LMSTUDIO_URL`, `LMSTUDIO_MODEL`).

Die drei OpenAI-kompatiblen Fälle teilen eine Klasse
(`OpenAICompatProvider`); sie unterscheiden sich nur in Base-URL, Modell und
Auth-Header. Fehlende Pflicht-Variablen und ein unbekannter
`LLM_PROVIDER`-Wert werden nicht verschluckt: `POST /api/:campaign/generate`
antwortet `503` mit der Meldung im Klartext. Vollständige Variablen-Tabelle:
docs/DEPLOYMENT.md Abschnitt 2.
