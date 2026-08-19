# Generator

Pipeline: Quelltext (EN) → LLM → Szenen-Drafts (DE) → Review-Vorschau → Platte.

## Ablauf pro Aufruf

1. Server sammelt Kontext: alle npc-/location-ids + Namen, Kapitel-id,
   `glossary.md`.
2. Prompt = `system-prompt.md` + `example-output.md` (Few-Shot-Ziel)
   + Kontext + Quelltext.
3. LLM antwortet mit JSON (Schema siehe system-prompt.md).
4. Server validiert mechanisch:
   - Frontmatter parsebar? `type`/`status` gültig? `status == draft`?
   - alle `npcs`-/`location`-Referenzen existieren ODER liegen als Stub bei?
   - nur bekannte Callout-Typen?
   Fehler gehen als Korrektur-Turn zurück ans LLM (max. 2 Versuche),
   nicht an den Nutzer.
5. App zeigt Review-Vorschau: Szenen editierbar, Stubs einzeln
   annehmen/ablehnen. Erst „Übernehmen" schreibt auf die Platte.

## Provider

Abstraktion in `server/src/llm-provider.ts`. Start: Claude API.
Später umschaltbar auf LM Studio (OpenAI-kompatibler Endpoint) per Config.
