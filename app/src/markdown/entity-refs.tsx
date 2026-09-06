// Resolution of `[[slug]]` body references at RENDER TIME (issue #68).
//
// The remark plugin only marks a reference (`<span data-entity-ref="slug">`
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
//     half-typed Schnellnotiz (the same reason the aside cards stopped
//     navigating in issue #40). The live route supplies `onOpen`.
//
// Unresolved stays literal text: no red, no tooltip, no icon. The reference
// simply becomes alive the moment the entity exists — without touching the
// body again.

import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Link } from "react-router";

import type { CampaignTree } from "@grimoire/shared/types";
import { ENTITY_REF_KINDS, type EntityRefKind } from "@grimoire/shared/refs";

import { fetchTree } from "@/api";

/** What a slug resolves to: the CURRENT display name plus where it lives. */
export interface ResolvedEntityRef {
  kind: EntityRefKind;
  slug: string;
  name: string;
  /** Campaign-relative file path — the tree's own, never re-derived. */
  path: string;
}

interface EntityRefContextValue {
  campaign: string;
  resolve: (slug: string) => ResolvedEntityRef | undefined;
  /** Live view only: open the entity in the drawer instead of navigating. */
  onOpen?: (path: string) => void;
}

const NO_REFS: EntityRefContextValue = { campaign: "", resolve: () => undefined };

const EntityRefContext = createContext<EntityRefContextValue>(NO_REFS);

/**
 * Build the slug→entity lookup from a tree.
 *
 * KIND PRIORITY (npc > location > scene, ENTITY_REF_KINDS): slugs are unique
 * per kind but not across kinds, so the first kind that knows a slug wins —
 * see @grimoire/shared/refs for why the order is this one.
 */
export function entityRefIndex(
  tree: CampaignTree | undefined,
): Map<string, ResolvedEntityRef> {
  const index = new Map<string, ResolvedEntityRef>();
  if (tree === undefined) return index;

  const put = (kind: EntityRefKind, slug: string, name: string, path: string): void => {
    if (index.has(slug)) return; // an earlier (higher-priority) kind won
    index.set(slug, { kind, slug, name: name === "" ? slug : name, path });
  };

  for (const kind of ENTITY_REF_KINDS) {
    if (kind === "npc") {
      for (const npc of tree.npcs) put("npc", npc.id, npc.name, npc.path);
    } else if (kind === "location") {
      for (const location of tree.locations) put("location", location.id, location.name, location.path);
    } else {
      for (const chapter of tree.chapters) {
        for (const group of chapter.groups) {
          for (const scene of group.scenes) put("scene", scene.id, scene.title, scene.path);
        }
      }
    }
  }
  return index;
}

/**
 * The resolver as a plain value — the seam the render tests use, and what
 * `EntityRefProvider` fills from the tree query.
 */
export function EntityRefScope({
  campaign,
  index,
  onOpen,
  children,
}: {
  campaign: string;
  index: Map<string, ResolvedEntityRef>;
  onOpen?: (path: string) => void;
  children: ReactNode;
}) {
  const value = useMemo<EntityRefContextValue>(
    () => ({ campaign, resolve: (slug) => index.get(slug), ...(onOpen ? { onOpen } : {}) }),
    [campaign, index, onOpen],
  );
  return <EntityRefContext.Provider value={value}>{children}</EntityRefContext.Provider>;
}

/**
 * Mounts the resolver for one campaign. The tree query is the SAME query key
 * every other view uses, so this adds no extra request — and a rename of a
 * display name reaches every rendered body through the existing version poll.
 */
export function EntityRefProvider({
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
  const index = useMemo(() => entityRefIndex(tree.data), [tree.data]);
  return (
    <EntityRefScope campaign={campaign} index={index}>
      {children}
    </EntityRefScope>
  );
}

/**
 * Live-view wrapper: keeps the resolver, redirects the CLICK into the drawer.
 * Nested inside the provider, so the tree is not fetched twice.
 */
export function EntityRefDrawerTarget({
  onOpen,
  children,
}: {
  onOpen: (path: string) => void;
  children: ReactNode;
}) {
  const outer = useContext(EntityRefContext);
  const value = useMemo<EntityRefContextValue>(() => ({ ...outer, onOpen }), [outer, onOpen]);
  return <EntityRefContext.Provider value={value}>{children}</EntityRefContext.Provider>;
}

export function useEntityRefs(): EntityRefContextValue {
  return useContext(EntityRefContext);
}

/** German label of what a reference points at — for the accessible name. */
const KIND_LABEL: Record<EntityRefKind, string> = {
  npc: "NPC",
  location: "Ort",
  scene: "Szene",
};

const REF_CLASS =
  "rounded-sm text-primary underline decoration-primary/40 decoration-dotted underline-offset-[3px] hover:text-primary-hover hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * A reference where an interactive element must NOT go: the `## If:` summary
 * row, whose whole job is to fold its branch. It resolves like any other
 * reference — the DM reads "Falls Jorna gewarnt wurde", not `[[jorna]]` — but
 * it is plain text, so the click stays the toggle's (issue #68 review).
 */
export function EntityRefName({ slug, fallback }: { slug: string; fallback: ReactNode }) {
  const target = useEntityRefs().resolve(slug);
  return <>{target === undefined ? fallback : target.name}</>;
}

/**
 * One `[[slug]]` in a body. `fallback` is the literal source text the plugin
 * put inside the span — what an unresolved reference keeps showing.
 */
export function EntityRef({ slug, fallback }: { slug: string; fallback: ReactNode }) {
  const { campaign, resolve, onOpen } = useEntityRefs();
  const target = resolve(slug);

  // Degrade: plain text, exactly as typed. Not an error, not a warning colour.
  if (target === undefined) return <>{fallback}</>;

  const label = `${KIND_LABEL[target.kind]}: ${target.name}`;

  if (onOpen !== undefined) {
    return (
      <button type="button" onClick={() => onOpen(target.path)} aria-label={label} className={REF_CLASS}>
        {target.name}
      </button>
    );
  }
  return (
    <Link to={`/${campaign}/file/${target.path}`} aria-label={label} className={REF_CLASS}>
      {target.name}
    </Link>
  );
}
