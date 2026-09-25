// What the hover preview of a `[[slug]]` reference to a location says: the
// kind, then the rows of the compact card. The name is known before anything
// loads — the tree that resolved the reference has it — so the card opens
// labelled. The rest comes with the location's own query (the key its card
// and drawer share); while it loads, static bars stand in, and if it fails
// the card simply keeps kind and name.

import { useQuery } from "@tanstack/react-query";

import { CompactHead, CompactName, CompactPlaceholder } from "@/components/Compact";
import { useT } from "@/i18n";

import { LocationCompact } from "./LocationCompact";
import { locationExcerpt } from "./location-excerpt";
import { locationQuery } from "./location-query";

export function LocationPreview({
  campaign,
  id,
  name,
  nameOf,
}: {
  campaign: string;
  id: string;
  name: string;
  /** Display name of a slug — references inside the atmosphere read as names. */
  nameOf: (slug: string) => string | undefined;
}) {
  const t = useT();
  const location = useQuery({
    ...locationQuery(campaign, id),
    retry: false,
    retryOnMount: false,
    staleTime: Infinity,
  });
  return (
    <>
      <CompactHead kind={t("kind.location")} />
      {location.data === undefined ? (
        <>
          <CompactName name={name} />
          {location.isPending && <CompactPlaceholder widths={["w-[85%]", "w-[60%]"]} />}
        </>
      ) : (
        <LocationCompact name={name} excerpt={locationExcerpt(location.data, nameOf)} clamp />
      )}
    </>
  );
}
