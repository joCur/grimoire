# Reference data belongs to the instance

## Decision

Next to campaign content, Grimoire holds **reference data**: fixed tables
from a published source that the DM looks up at the table, such as what a
magic item costs.

- **Reference data belongs to the instance, not to a campaign.** The same
  rows serve every campaign; they carry no campaign column, and their
  resources hang outside `/campaigns/:id` in the API. In the app they are
  pages of the campaign the DM is in, reached like every other area
  (`decisions/resources`), so looking something up never leaves the campaign.
- **It is shipped with the app and written by a migration.** A fresh instance
  has it without a seed; a new version of the source is a new migration. The
  empty start (`decisions/sqlite`) is about campaign content.
- **It is looked up, not edited.** There is no write path; the DM's own
  additions are campaign content and belong in the campaign.
- **It names its source.** Every page and every row of reference data says
  where it comes from, with a link, as the source asks to be credited.
- **One row per thing, whatever the number of sources.** Where several
  sources cover the same thing, the most specific one gives the value and a
  coarser one only fills the gaps; the row names the source its value comes
  from, so the DM can tell a precise value from a rough one.
- **The search finds it from every campaign.** Its index rows carry no
  campaign, and a hit names its entity like every other (`kind` and `id`).
- **Only sources shared for use.** A source goes in only if its author shares
  it for use; what cannot be shipped is not imported.

## Why

A price list or a rules table is the same in every campaign. Copying it into
each campaign would multiply rows that nobody changes and let copies drift
apart; one set of rows is the truth, like everything else in the database.

Shipping it by migration keeps a single write path for it and keeps a fresh
instance usable at the table on the first evening, without a seed that is
otherwise a dev tool.

Editing would turn the reference into campaign content with a different
owner. A DM who wants other prices writes them into the campaign, where they
belong to that campaign.

## Consequences

- A new source is a new table with its own resource and a migration that
  fills it; nothing about campaigns changes.
- The search spans a campaign's own rows and the instance's reference data.
