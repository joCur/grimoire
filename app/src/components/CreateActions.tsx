// The two parts every create entry point is built from: the trigger, and the
// step after a successful create. Each entity's create action lives in its
// slice (chapter/, scene/, npc/, location/, campaign/) and wraps the shared
// CreateDialog with them — what happens after a create differs per entity,
// which is the point of having one wrapper each.
//
// PLACEHOLDERS ARE GENERIC: every field hint names the KIND of thing that
// belongs there (the scene's title, the location's name), never a name out of
// the example campaign — a placeholder that reads like real campaign content
// is taken for a default.

import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { HeaderAction } from "@/components/HeaderAction";
import { Button } from "@/components/ui/button";

/**
 * The step after every create: the reads that list the new row are refetched
 * — the tree (every list and the chapter overview read it), the campaign list
 * and the search index — plus whatever list of its own the caller names.
 */
export function useAfterCreate(campaign: string, ...lists: readonly QueryKey[]) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all(
      [["tree", campaign], ["campaigns"], ["search", campaign], ...lists].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
  };
}

/**
 * The trigger. `variant: "primary"` is the empty state's next step — a real
 * button, because there is nothing else on the surface to be quiet next to;
 * everywhere else it is the header vocabulary of the reading view.
 */
export function CreateTrigger({
  label,
  variant,
  onClick,
}: {
  label: string;
  variant: "quiet" | "primary";
  onClick: () => void;
}) {
  if (variant === "primary") {
    return (
      <Button
        type="button"
        onClick={onClick}
        className="h-auto min-h-11 px-4 py-2 text-[13.5px] font-semibold"
      >
        {label}
      </Button>
    );
  }
  return <HeaderAction icon={Plus} label={label} onClick={onClick} />;
}
