// One scene row of the chapter overview. The row opens the scene — except the
// status area, which is its own control (same menu as the reading view). The
// link therefore covers everything but that control instead of wrapping it: a
// button inside an anchor is invalid markup and would need click juggling,
// two siblings in one hover row need neither.

import type { SceneSummary } from "@grimoire/shared/campaign-tree";
import { ArrowDown, ArrowUp, Bookmark, GitFork } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { useT } from "@/i18n";

import { SceneStatusControl } from "./SceneStatusMenu";
import { sceneHref } from "./scene-links";

export function SceneRow({
  campaign,
  scene,
  first,
  last,
  busy,
  onMove,
}: {
  campaign: string;
  scene: SceneSummary;
  /** Ends of the DISPLAYED block — where the move has nowhere to go. */
  first: boolean;
  last: boolean;
  /** A move of this chapter is on the wire; the rows hold still until it lands. */
  busy: boolean;
  onMove: (delta: -1 | 1) => void;
}) {
  const t = useT();
  const isContingency = scene.type === "contingency";
  // The location is a word of the scene, not a heading above it — the NAME
  // the server resolved, degraded to the id it could not resolve. A scene
  // without one simply has no location part: no placeholder, no dangling
  // separator (decisions/scene-order).
  const meta = [scene.locationName ?? scene.location, scene.tags.map((tag) => `#${tag}`).join(" ")]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");

  return (
    <div className="group flex items-center gap-3 rounded-md border-b border-divider px-2.5 hover:bg-card">
      <Link
        to={sceneHref(campaign, scene.id)}
        className="flex min-w-0 flex-1 items-center gap-3 py-[13px]"
      >
        {isContingency ? (
          <GitFork aria-hidden size={17} className="flex-none text-muted-foreground" />
        ) : (
          <Bookmark aria-hidden size={17} className="flex-none text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] text-foreground">{scene.title}</span>
          {isContingency && scene.trigger !== undefined ? (
            <span className="mt-0.5 block text-[12.5px] text-muted-foreground italic">
              {t("chapterOverview.scene.trigger", { trigger: scene.trigger })}
            </span>
          ) : meta !== "" ? (
            <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{meta}</span>
          ) : null}
        </span>
      </Link>
      {/* Quiet until the row is the one in hand (UI-BRIEF §1): the pair fades
          in on hover and on keyboard focus, and it is never a standing label
          next to every scene. Opacity only — the buttons stay in the tab order
          and keep their accessible names either way. */}
      <span className="flex flex-none items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
        <MoveButton
          label={t("chapterOverview.scene.moveUp.aria", { title: scene.title })}
          disabled={first || busy}
          onClick={() => onMove(-1)}
        >
          <ArrowUp aria-hidden />
        </MoveButton>
        <MoveButton
          label={t("chapterOverview.scene.moveDown.aria", { title: scene.title })}
          disabled={last || busy}
          onClick={() => onMove(1)}
        >
          <ArrowDown aria-hidden />
        </MoveButton>
      </span>
      {/* No rev in the tree — the control fetches the scene when it opens. */}
      <SceneStatusControl campaign={campaign} id={scene.id} status={scene.status} variant="row" />
    </div>
  );
}

/** Icon-only up/down control of a row — named for screen readers by its scene. */
function MoveButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-panel-deep hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35 motion-reduce:transition-none [&_svg]:size-[15px]"
    >
      {children}
    </button>
  );
}
