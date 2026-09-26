# The repository is written in English

## Decision

Everything in the repository is written in English: code, identifiers,
comments, test names, commit messages and PR titles, documentation,
decisions, instructions for agents such as `CLAUDE.md`, the content of the
example campaign in `fixtures/`, and tests.

German exists in exactly one place: the German UI catalog in
`app/src/i18n/`, which is the German language of the product. Tests do not
depend on UI text at all (`decisions/testing`), so the language of the UI
never matters to them.

German anywhere else is a violation of this rule, not an exception. It is
removed by the scout rule: whoever touches a file for another reason
converts that whole file's German to English in the same change. There are
no separate cleanup changes.

## Why

One language for code, content and collaborators means nobody has to switch
languages mid-file, names, comments and example content are searchable in
one vocabulary, and every contributor, human or agent, can read everything.
The product stays bilingual through the catalog (`decisions/i18n`); the
repository language does not decide the UI language, so the catalog is the
only place where German belongs.

Converting touched files whole, instead of in a dedicated sweep, spreads the
cost over work that reviews the file anyway and avoids mixed-language files.

## Consequences

- German outside the German catalog, whether a comment, a heading, a test
  name or fixture content, is a review finding.
- UI labels are described in English in code and docs; the German wording
  lives only in the catalog.
