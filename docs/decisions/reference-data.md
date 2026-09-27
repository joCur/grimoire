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
- **What may ship is shipped with the app and written by a migration.** A
  fresh instance has it without a seed; a new version of the source is a new
  migration. The empty start (`decisions/sqlite`) is about campaign content.
- **What may not ship, the DM imports into their own instance.** A source
  the DM owns but that is not shared for use — the books on their shelf —
  comes in as a list the DM brings, not with the app. An import is reference
  data of the instance like the shipped rows; it holds facts to look up (a
  name, a rarity), never the source's text. Importing a list again replaces
  what that list brought, and removing it removes that. The rows live only in
  that instance's database, never in the repository or the image.
- **It is looked up, not edited.** Beside its migration and the DM's import
  there is no write path, and no row is changed on its own; the DM's own
  prices for a campaign are campaign content and belong in the campaign.
- **It names its source.** Every page and every row of reference data says
  where it comes from, with a link where the source asks to be credited; an
  imported row names the DM's list it came from.
- **One row per thing, whatever the number of sources.** Where several
  sources cover the same thing, the most specific one gives the value and a
  coarser one only fills the gaps; the row names the source its value comes
  from, so the DM can tell a precise value from a rough one. A shipped row
  stands before an imported one: an import adds what is missing and never
  overrides what is there.
- **The search finds it from every campaign.** Its index rows carry no
  campaign, and a hit names its entity like every other (`kind` and `id`).
- **Only sources shared for use ship.** A source goes into the app only if
  its author shares it for use; what cannot be shipped is not imported by
  the app, only by the DM who owns it.

## Why

A price list or a rules table is the same in every campaign. Copying it into
each campaign would multiply rows that nobody changes and let copies drift
apart; one set of rows is the truth, like everything else in the database.

Shipping it by migration keeps a single write path for what the app is
allowed to carry, and keeps a fresh instance usable at the table on the first
evening, without a seed that is otherwise a dev tool.

Most of what a DM looks up stands in books whose content may not travel with
the app. The DM who owns them may still use what they own at their own
table; an import lets them do that without the app ever holding it. A list
that comes in whole and goes out whole keeps the import a single, repeatable
act instead of a second editor for reference data.

Editing would turn the reference into campaign content with a different
owner. A DM who wants other prices writes them into the campaign, where they
belong to that campaign.

## Consequences

- A new shipped source is a new table with its own resource and a migration
  that fills it; nothing about campaigns changes.
- An importable kind of reference data has an import resource of its own,
  one row per list the DM brought, whose write replaces the list's rows as a
  whole.
- The search spans a campaign's own rows and the instance's reference data,
  shipped and imported.
