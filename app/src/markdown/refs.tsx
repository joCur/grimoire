// Resolution of `[[slug]]` body references at RENDER TIME.
//
// The remark plugin only marks a reference (`<span data-ref="slug">`
// with the literal `[[slug]]` inside); WHAT it means is a question only the
// campaign tree can answer, and the tree lives in the react-query cache. So
// the resolver is a context: mounted once per campaign (App.tsx), read by
// every Markdown body no matter which view renders it.
//
// Two behaviours, one component:
//
//   * reading views — a resolved reference is a LINK to the entity view;
//   * the live view — it is a BUTTON that opens the existing entity drawer,
//     because leaving the live route costs the DM the selected scene and the
//     half-typed quick note (the same reason the aside cards stopped
//     navigating). The live route supplies `onOpen`.
//
// Either way a resolved reference previews its target on hover and keyboard
// focus (./ref-preview.tsx) — the click stays exactly what it is.
//
// Unresolved stays literal text: no red, no tooltip, no icon. The reference
// simply becomes alive the moment its target exists — without touching the
// body again.
//
// This module only ASSIGNS a slug to what it names — an npc, a location or a
// scene — out of the tree. Where the reference leads and what its preview
// shows come from the one that is named (lib/open-target.ts,
// components/RefTargetPreview.tsx, and from there the slice of each).

import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Link } from "react-router";

import type { CampaignTree } from "@grimoire/shared/campaign-tree";
import { REF_KINDS, type RefKind } from "@grimoire/shared/refs";

import { fetchTree } from "@/api";
import { useT, type MessageKey } from "@/i18n";
import { openTargetHref, type OpenTarget } from "@/lib/open-target";

import { RefPreview, useCanHover, type RefPreviewTrigger } from "./ref-preview";

/**
 * What a slug resolves to: which of the three it names, and its CURRENT
 * display name. Each is its own resource, reached by its id (ADR #31).
 */
export interface ResolvedRef {
  kind: RefKind;
  slug: string;
  name: string;
}

/** What a resolved reference opens. */
export function refTarget(target: ResolvedRef): OpenTarget {
  return { kind: target.kind, id: target.slug };
}

interface RefContextValue {
  campaign: string;
  resolve: (slug: string) => ResolvedRef | undefined;
  /** Live view only: open the entity in the drawer instead of navigating. */
  onOpen?: (target: OpenTarget) => void;
}

const NO_REFS: RefContextValue = { campaign: "", resolve: () => undefined };

const RefContext = createContext<RefContextValue>(NO_REFS);

/**
 * Build the slug→entity lookup from a tree.
 *
 * KIND PRIORITY (npc > location > scene, REF_KINDS): slugs are unique
 * per kind but not across kinds, so the first kind that knows a slug wins —
 * see @grimoire/shared/refs for why the order is this one.
 */
export function refIndex(
  tree: CampaignTree | undefined,
): Map<string, ResolvedRef> {
  const index = new Map<string, ResolvedRef>();
  if (tree === undefined) return index;

  const put = (ref: ResolvedRef): void => {
    if (index.has(ref.slug)) return; // an earlier (higher-priority) kind won
    index.set(ref.slug, { ...ref, name: ref.name === "" ? ref.slug : ref.name });
  };

  for (const kind of REF_KINDS) {
    if (kind === "npc") {
      for (const npc of tree.npcs) put({ kind: "npc", slug: npc.id, name: npc.name });
    } else if (kind === "location") {
      for (const location of tree.locations) {
        put({ kind: "location", slug: location.id, name: location.name });
      }
    } else {
      for (const chapter of tree.chapters) {
        for (const scene of chapter.scenes) {
          put({ kind: "scene", slug: scene.id, name: scene.title });
        }
      }
    }
  }
  return index;
}

/**
 * The resolver as a plain value — the seam the render tests use, and what
 * `RefProvider` fills from the tree query.
 */
export function RefScope({
  campaign,
  index,
  onOpen,
  children,
}: {
  campaign: string;
  index: Map<string, ResolvedRef>;
  onOpen?: (target: OpenTarget) => void;
  children: ReactNode;
}) {
  const value = useMemo<RefContextValue>(
    () => ({ campaign, resolve: (slug) => index.get(slug), ...(onOpen ? { onOpen } : {}) }),
    [campaign, index, onOpen],
  );
  return <RefContext.Provider value={value}>{children}</RefContext.Provider>;
}

/**
 * Mounts the resolver for one campaign. The tree query is the SAME query key
 * every other view uses, so this adds no extra request — and a changed
 * display name reaches every rendered body through the existing version poll.
 */
export function RefProvider({
  campaign,
  children,
}: {
  campaign: string;
  children: ReactNode;
}) {
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });
  const index = useMemo(() => refIndex(tree.data), [tree.data]);
  return (
    <RefScope campaign={campaign} index={index}>
      {children}
    </RefScope>
  );
}

/**
 * Live-view wrapper: keeps the resolver, redirects the CLICK into the drawer.
 * Nested inside the provider, so the tree is not fetched twice.
 */
export function RefDrawerTarget({
  onOpen,
  children,
}: {
  onOpen: (target: OpenTarget) => void;
  children: ReactNode;
}) {
  const outer = useContext(RefContext);
  const value = useMemo<RefContextValue>(() => ({ ...outer, onOpen }), [outer, onOpen]);
  return <RefContext.Provider value={value}>{children}</RefContext.Provider>;
}

export function useRefs(): RefContextValue {
  return useContext(RefContext);
}

/**
 * What a reference points at, for the accessible name — the SAME kind labels
 * the ⌘K rows and the properties dialog use (`kind.*`, i18n/de.ts), so a
 * screen reader hears one vocabulary and it follows the UI language.
 */
const KIND_KEY: Record<RefKind, MessageKey> = {
  npc: "kind.npc",
  location: "kind.location",
  scene: "kind.scene",
};

const REF_CLASS =
  "rounded-sm text-primary underline decoration-primary/40 decoration-dotted underline-offset-[3px] hover:text-primary-hover hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * A reference where an interactive element must NOT go: the `## If:` summary
 * row, whose whole job is to fold its branch. It resolves like any other
 * reference — the DM reads "Falls Jorna gewarnt wurde", not `[[jorna]]` — but
 * it is plain text, so the click stays the toggle's.
 */
export function RefName({ slug, fallback }: { slug: string; fallback: ReactNode }) {
  const target = useRefs().resolve(slug);
  return <>{target === undefined ? fallback : target.name}</>;
}

/**
 * One `[[slug]]` in a body. `fallback` is the literal source text the plugin
 * put inside the span — what an unresolved reference keeps showing.
 */
export function RefLink({ slug, fallback }: { slug: string; fallback: ReactNode }) {
  const { campaign, resolve, onOpen } = useRefs();
  const t = useT();
  const canHover = useCanHover();
  const target = resolve(slug);

  // Degrade: plain text, exactly as typed. Not an error, not a warning colour.
  if (target === undefined) return <>{fallback}</>;

  const label = t("markdown.ref.aria", {
    kind: t(KIND_KEY[target.kind]),
    name: target.name,
  });

  const reference = (trigger?: RefPreviewTrigger, anchor?: ReactNode) =>
    onOpen !== undefined ? (
      <button
        type="button"
        onClick={() => onOpen(refTarget(target))}
        aria-label={label}
        className={REF_CLASS}
        {...trigger}
      >
        {anchor}
        {target.name}
      </button>
    ) : (
      <Link
        to={openTargetHref(campaign, refTarget(target))}
        aria-label={label}
        className={REF_CLASS}
        {...trigger}
      >
        {anchor}
        {target.name}
      </Link>
    );

  // Touch: no preview and no listeners — a tap is the click it always was.
  if (!canHover) return reference();
  return (
    <RefPreview campaign={campaign} target={target} nameOf={(other) => resolve(other)?.name}>
      {reference}
    </RefPreview>
  );
}
