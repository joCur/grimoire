# The repository is written in English

## Decision

Everything in the repository is written in English: code, identifiers,
comments, test names, commit messages and PR titles, documentation,
decisions, and instructions for agents such as `CLAUDE.md`.

German exists only as product content:

- the German UI catalog in `app/src/i18n/`,
- the content of the example campaign in `fixtures/`,
- literal UI strings that tests assert against.

Existing German outside these places is removed by the scout rule: whoever
touches a file for another reason converts that whole file's German prose,
comments and test names to English in the same change. There are no separate
cleanup changes.

## Why

One language for code and collaborators means nobody has to switch
languages mid-file, names and comments are searchable in one vocabulary, and
every contributor, human or agent, can read everything. The product stays
bilingual through the catalog (`decisions/i18n`); the repository language
does not decide the UI language.

Converting touched files whole, instead of in a dedicated sweep, spreads the
cost over work that reviews the file anyway and avoids mixed-language files.

## Consequences

- A German comment, heading or test name outside the exceptions is a review
  finding.
- UI labels are described in English in code and docs; the German wording
  lives only in the catalog.
