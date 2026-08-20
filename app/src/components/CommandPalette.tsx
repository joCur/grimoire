// The ⌘K search palette (issue #7), per the design reference: dimmed
// backdrop, 560px panel at 14vh, search input with esc chip, result rows
// (kind icon · title · German kind label). Built on the Radix Dialog
// primitives (focus trap, Esc, outside-click, aria-modal) with a manual
// combobox/listbox pattern for the results — cmdk was skipped because the
// server does all filtering/ranking; client-side re-filtering would fight
// the Fuse.js scores.

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { fetchSearch, fetchTree } from "@/api";
import { contingencyPaths, kindIcon, kindLabel, resultHref } from "@/lib/search";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/lib/use-debounced-value";

interface CommandPaletteProps {
  campaign: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Register the global ⌘K/Ctrl-K toggle (default). The mobile start surface
   * mounts a second palette instance and turns this off so the shortcut only
   * ever opens the topbar's instance.
   */
  hotkey?: boolean;
}

export function CommandPalette({
  campaign,
  open,
  onOpenChange,
  hotkey = true,
}: CommandPaletteProps) {
  const navigate = useNavigate();
  const listboxId = useId();

  // ⌘K / Ctrl-K toggles globally (the palette is only mounted on
  // campaign-scoped views, so the shortcut is inert on the campaign list).
  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange, hotkey]);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const term = useDebouncedValue(query, 150).trim();

  // The server 400s on an empty query — never call it with one.
  const search = useQuery({
    queryKey: ["search", campaign, term],
    queryFn: () => fetchSearch(campaign, term),
    enabled: open && term !== "",
    placeholderData: keepPreviousData, // no flicker while typing
  });

  // Shares the react-query cache with the pool — only used to tell
  // contingency scenes apart for the fork icon (degrades to the bookmark).
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: open,
  });
  const forkPaths = useMemo(() => contingencyPaths(tree.data), [tree.data]);

  // Empty query shows nothing yet; results only exist for a non-empty term.
  const results = term === "" ? [] : (search.data?.results ?? []);
  const showNoResults = term !== "" && search.isSuccess && results.length === 0;
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setQuery("");
      setActive(0);
    }
  }

  function pick(index: number) {
    const result = results[index];
    if (result === undefined) return;
    handleOpenChange(false);
    void navigate(resultHref(campaign, result));
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((activeIndex + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((activeIndex - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(activeIndex);
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // Full-width-ish on touch viewports; at md+ the calc exceeds the
          // 560px cap, so the desktop panel is unchanged.
          className="fixed top-[14vh] left-1/2 z-50 w-[calc(100vw-32px)] max-w-[560px] -translate-x-1/2 overflow-hidden rounded-xl border border-input bg-card shadow-[0_24px_60px_rgba(0,0,0,.5)]"
        >
          <DialogPrimitive.Title className="sr-only">Suchen</DialogPrimitive.Title>
          <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
            <Search aria-hidden size={16} className="flex-none text-muted-foreground" />
            <input
              // Radix focuses the first focusable element on open — this input.
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onInputKeyDown}
              placeholder="Szenen, NPCs, Orte durchsuchen …"
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls={listboxId}
              aria-activedescendant={results.length > 0 ? optionId(activeIndex) : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
              // 16px below md — anything smaller makes iOS zoom into the input.
              className="min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted-foreground md:text-[15px]"
            />
            <span
              aria-hidden
              className="flex-none rounded-[4px] border border-input px-[5px] py-px font-mono text-[11px] text-muted-foreground max-md:hidden"
            >
              esc
            </span>
          </div>
          <div
            role="listbox"
            id={listboxId}
            aria-label="Suchergebnisse"
            className="max-h-[320px] overflow-y-auto p-2"
          >
            {showNoResults && (
              <p className="p-5 text-center text-[13.5px] text-muted-foreground">
                Nichts gefunden.
              </p>
            )}
            {results.map((result, index) => {
              const Icon = kindIcon(result.kind, forkPaths.has(result.path));
              return (
                <div
                  key={result.path}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === activeIndex}
                  onPointerMove={() => setActive(index)}
                  onClick={() => pick(index)}
                  className={cn(
                    "flex cursor-pointer items-center gap-[11px] rounded-[7px] px-2.5 py-2.5 max-md:min-h-11",
                    index === activeIndex && "bg-secondary",
                  )}
                >
                  <Icon aria-hidden size={15} className="flex-none text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {result.title}
                  </span>
                  <span className="flex-none text-xs text-muted-foreground">
                    {kindLabel(result.kind)}
                  </span>
                </div>
              );
            })}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
