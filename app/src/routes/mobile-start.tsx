// The mobile start surface (issue #11) — rendered by the pool route below
// the md breakpoint per design/Grimoire-Mobil.dc.html: wordmark row, tappable
// search field (opens the ⌘K palette, touch-first), inbox capture card
// (POST /api/:campaign/inbox) and the "Nachschlagen" rows into the mobile
// list pages. The prototype's "Zuletzt angesehen" section is deliberately
// left out: recents would need server-side persistence (no localStorage —
// the server is the truth) and there is no recents endpoint yet.

import { useMutation, useQuery } from "@tanstack/react-query";
import { Bookmark, ChevronRight, MapPin, Search, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";

import { appendInbox, fetchTree } from "@/api";
import { CommandPalette } from "@/components/CommandPalette";
import { Button } from "@/components/ui/button";
import { IconLogo } from "@/icons";
import { cn } from "@/lib/utils";

function countLabel(count: number | undefined, singular: string, plural: string) {
  if (count === undefined) return undefined;
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

export function MobileStart({ campaign }: { campaign: string }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const { data: tree } = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });
  const sceneCount = tree?.chapters.reduce(
    (n, ch) => n + ch.groups.reduce((m, g) => m + g.scenes.length, 0),
    0,
  );

  return (
    <div className="mx-auto flex max-w-[560px] flex-col px-5 pt-5 pb-16">
      <div className="mb-5 flex items-center gap-2.5">
        <IconLogo size={20} className="text-primary" />
        <span className="font-serif text-[22px] leading-[1.2] font-semibold text-foreground">
          Grimoire
        </span>
        <span className="min-w-0 truncate text-[13px] text-muted-foreground">
          Kampagne: {campaign}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="mb-3.5 flex min-h-12 w-full items-center gap-2.5 rounded-xl border border-input bg-card px-4 py-3 text-left text-[15px] text-muted-foreground"
      >
        <Search aria-hidden size={17} className="flex-none" />
        Szenen, NPCs, Orte suchen …
      </button>
      {/* Second palette instance next to the topbar's — without the global
          ⌘K listener, so the shortcut only ever toggles one of them. */}
      <CommandPalette
        campaign={campaign}
        open={searchOpen}
        onOpenChange={setSearchOpen}
        hotkey={false}
      />

      <InboxCard campaign={campaign} />

      <nav aria-label="Nachschlagen" className="mt-8">
        <p className="mb-1 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
          Nachschlagen
        </p>
        <BrowseRow
          to={`/${campaign}/list/scenes`}
          icon={Bookmark}
          label="Szenen"
          meta={countLabel(sceneCount, "Szene", "Szenen")}
        />
        <BrowseRow
          to={`/${campaign}/list/npcs`}
          icon={User}
          label="NPCs"
          meta={countLabel(tree?.npcs.length, "NPC", "NPCs")}
        />
        <BrowseRow
          to={`/${campaign}/list/locations`}
          icon={MapPin}
          label="Orte"
          meta={countLabel(tree?.locations.length, "Ort", "Orte")}
        />
      </nav>
    </div>
  );
}

function BrowseRow({
  to,
  icon: Icon,
  label,
  meta,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  meta: string | undefined;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-[52px] items-center gap-3 rounded-md border-b border-divider px-1 hover:bg-card"
    >
      <Icon aria-hidden size={16} className="flex-none text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-[15px] text-foreground">{label}</span>
      {meta !== undefined && (
        <span className="flex-none text-[12.5px] text-muted-foreground">{meta}</span>
      )}
      <ChevronRight aria-hidden size={15} className="flex-none text-faint" />
    </Link>
  );
}

/** Inbox capture: textarea + brass "Einwerfen", quiet text confirmation
 * (no animation — reduced-motion safe by construction). */
function InboxCard({ campaign }: { campaign: string }) {
  const inputId = useId();
  const [text, setText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const inbox = useMutation({
    mutationFn: (line: string) => appendInbox(campaign, line),
    onSuccess: () => {
      setText("");
      setConfirmed(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setConfirmed(false), 2500);
    },
    onMutate: () => setConfirmed(false),
  });

  const send = () => {
    const line = text.trim();
    if (line === "" || inbox.isPending) return;
    inbox.mutate(line);
  };

  return (
    <div className="rounded-xl border border-input bg-card px-4 pt-3.5 pb-3">
      <label htmlFor={inputId} className="sr-only">
        Inbox
      </label>
      <textarea
        id={inputId}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Inbox — Idee einwerfen … #thread #npc"
        className="min-h-11 w-full resize-none bg-transparent text-[16px] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground md:text-[15px]"
      />
      <div className="flex items-center justify-end gap-3 pt-1">
        <p
          aria-live="polite"
          className={cn(
            "min-w-0 flex-1 truncate text-[12.5px]",
            confirmed ? "text-success-text" : "text-destructive",
          )}
        >
          {confirmed ? "Eingeworfen." : inbox.isError ? "Nicht gespeichert — Server prüfen." : ""}
        </p>
        <Button
          type="button"
          disabled={inbox.isPending}
          onClick={send}
          className="h-auto min-h-11 flex-none px-4 py-2 text-[14px] font-semibold"
        >
          Einwerfen
        </Button>
      </div>
    </div>
  );
}
