// A location in the live drawer: the same article its reading view shows,
// read through its own query, inside the shared drawer frame.

import { useQuery } from "@tanstack/react-query";

import { DrawerFrame } from "@/components/DrawerFrame";

import { LocationArticle } from "./LocationArticle";
import { locationHref } from "./location-links";
import { locationQuery } from "./location-query";

export function LocationDrawerBody({ campaign, id }: { campaign: string; id: string }) {
  const { data, isPending, isError } = useQuery({ ...locationQuery(campaign, id), retry: false });
  return (
    <DrawerFrame
      href={locationHref(campaign, id)}
      shown={id}
      name={data?.name ?? id}
      isPending={isPending}
      isError={isError}
    >
      {data !== undefined && <LocationArticle location={data} />}
    </DrawerFrame>
  );
}
