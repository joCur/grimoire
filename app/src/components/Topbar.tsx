// The constant topbar (design reference: 56px, hairline below). Left side
// is contextual: campaign switcher on the pool, breadcrumb on a scene.
// Right side: search placeholder (⌘K — the palette is a later slice) and,
// on the pool, the brass "Session starten" button (no-op until the live
// mode lands, issue #9).

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Play, Search } from "lucide-react";
import { Link, matchPath, useLocation, useNavigate } from "react-router";

import { fetchCampaigns, fetchFile, fetchTree } from "@/api";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconLogo } from "@/icons";
import { fmString } from "@/lib/frontmatter";
import { cn } from "@/lib/utils";

export function Topbar() {
  const { pathname } = useLocation();
  const sceneMatch = matchPath("/:campaign/file/*", pathname);
  const poolMatch = matchPath("/:campaign", pathname);
  const campaign = sceneMatch?.params.campaign ?? poolMatch?.params.campaign ?? "";
  const filePath = sceneMatch?.params["*"] ?? "";
  const isScene = sceneMatch !== null && filePath !== "" && campaign !== "";
  const isPool = poolMatch !== null && campaign !== "";

  // Shares the react-query cache with SceneRoute/PoolRoute — no extra fetch.
  const file = useQuery({
    queryKey: ["file", campaign, filePath],
    queryFn: () => fetchFile(campaign, filePath),
    enabled: isScene,
  });
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: isScene,
  });

  const fm = file.data?.frontmatter;
  const chapterId = fmString(fm?.chapter);
  const chapterTitle = tree.data?.chapters.find((c) => c.id === chapterId)?.title ?? chapterId;
  const sceneTitle = fmString(fm?.title) ?? filePath;

  return (
    <header className="flex h-14 flex-none items-center gap-3.5 border-b border-border px-6">
      <Link
        to="/"
        className="-ml-1.5 flex flex-none items-center gap-[9px] rounded-md px-1.5 py-1 font-serif text-[17px] font-semibold tracking-[.01em] text-foreground hover:text-primary-hover"
      >
        <IconLogo size={19} className="text-primary" />
        Grimoire
      </Link>

      {isPool && <CampaignSwitcher campaign={campaign} />}

      {isScene && (
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          <Link to={`/${campaign}`} className="flex-none text-body-secondary hover:text-foreground">
            {campaign}
          </Link>
          {chapterTitle !== undefined && (
            <>
              <span aria-hidden className="text-border-hover">/</span>
              <Link
                to={`/${campaign}`}
                className="truncate text-body-secondary hover:text-foreground"
              >
                {chapterTitle}
              </Link>
            </>
          )}
          <span aria-hidden className="text-border-hover">/</span>
          <span className="truncate text-soft">{sceneTitle}</span>
        </div>
      )}

      <div className="flex-1" />

      {/* Search placeholder — the ⌘K palette is a later slice. */}
      <Button
        type="button"
        variant="outline"
        disabled
        className="hidden h-auto min-w-[200px] gap-2 border-input bg-card px-3 py-1.5 text-[13px] font-normal text-body-secondary disabled:opacity-100 sm:flex"
      >
        <Search aria-hidden size={15} className="text-muted-foreground" />
        <span className="flex-1 text-left">Suchen …</span>
        <span className="rounded-[4px] border border-input px-[5px] py-px font-mono text-[11px] text-muted-foreground">
          ⌘K
        </span>
      </Button>

      {isPool && (
        <Button
          type="button"
          title="kommt mit dem Live-Modus"
          className="h-auto gap-2 px-4 py-2 text-[13px] font-semibold [&_svg]:size-[13px]"
        >
          <Play aria-hidden className="fill-current" />
          Session starten
        </Button>
      )}
    </header>
  );
}

function CampaignSwitcher({ campaign }: { campaign: string }) {
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ["campaigns"], queryFn: fetchCampaigns });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          buttonVariants({ variant: "ghost" }),
          "h-auto gap-[7px] rounded-md border border-transparent px-2.5 py-[5px] text-[13px] font-normal text-body-secondary hover:border-input hover:bg-transparent hover:text-foreground",
        )}
      >
        Kampagne: {campaign}
        <ChevronDown aria-hidden size={14} className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[290px]">
        {(data ?? []).map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => void navigate(`/${c.id}`)}>
            <span className="flex-1 text-[13.5px] text-foreground">{c.id}</span>
            {c.id === campaign && (
              <Check aria-hidden size={13} className="flex-none text-success-text" />
            )}
          </DropdownMenuItem>
        ))}
        {data !== undefined && data.length === 0 && (
          <p className="px-2.5 py-[9px] text-[13px] text-muted-foreground">
            Noch keine Kampagnen gefunden.
          </p>
        )}
        <DropdownMenuSeparator />
        <p className="px-2.5 pt-[7px] pb-[5px] text-[11.5px] text-faint">
          Kampagnen liegen als Ordner unter campaigns/
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
