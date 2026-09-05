// The migration hint (issue #57).
//
// When the one-time markdown → database import had to degrade something, the
// server keeps one report entry per incident. This is where the DM learns
// about it — once, quietly, on the campaign's own page.
//
// The tone is deliberate: an entry is NOT an error. Nothing was lost (the
// affected file is in the database verbatim, and the original markdown tree
// was never touched), so this is a reading task. Hence a collapsed line
// rather than a banner: it does not interrupt session prep, and it is right
// next to the content it talks about. A clean import renders NOTHING at all —
// no empty state, no reassurance nobody asked for.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, FileWarning } from "lucide-react";

import { fetchMigrationReport } from "@/api";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export function MigrationNotice({ campaign }: { campaign: string }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["migration-report", campaign],
    queryFn: () => fetchMigrationReport(campaign),
    enabled: campaign !== "",
    // The report is written once, by the import; there is nothing to poll.
    staleTime: Infinity,
  });
  const entries = data?.entries ?? [];
  if (entries.length === 0) return null;

  const count =
    entries.length === 1 ? "1 Hinweis" : `${entries.length} Hinweise`;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-5">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md border border-[color-mix(in_srgb,var(--primary)_30%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_7%,var(--card))] px-3 py-2 text-left text-[12.5px] text-body">
        <FileWarning aria-hidden size={14} className="flex-none text-muted-foreground" />
        <span>
          Übernahme aus den Markdown-Dateien: {count} zum Nachlesen
        </span>
        <ChevronDown
          aria-hidden
          size={14}
          className="ml-auto flex-none -rotate-90 text-muted-foreground transition-transform group-data-[state=open]:rotate-0"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 space-y-1.5 pl-1">
          {entries.map((entry, index) => (
            <li
              key={`${entry.path}-${index}`}
              className="text-[12.5px] leading-[1.55] text-body-secondary"
            >
              {entry.path !== "" && (
                <code className="mr-1.5 text-[12px] text-muted-foreground">{entry.path}</code>
              )}
              {entry.reason}
            </li>
          ))}
        </ul>
        <p className="mt-2 pl-1 text-[12px] leading-[1.5] text-muted-foreground">
          Nichts ist verloren: betroffene Dateien liegen unverändert in der
          Datenbank, und der ursprüngliche Dateibaum wurde nie angefasst.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
