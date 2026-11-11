// The frame of a chat with the model, without knowledge of what the chat is
// about: the brass button at the bottom right that opens it, the panel with
// its header, the scrolling conversation and the field below it.
//
// WHERE it stands is the DM's choice and lives in the URL (`?chat=popup` or
// `?chat=side`, `useChatMode`), so nothing is stored in the browser:
//
//   popup  a floating panel above the page, anchored bottom right; the page
//          behind it stays scrollable and usable. Esc closes it.
//   side   docked as a column at the right of the page, the full height below
//          the topbar; the page that draws the panel beside it narrows.
//   phone  either way a sheet from the bottom edge, nearly the whole screen.
//
// The panel takes the focus when it opens — its field, named by `inputId` —
// and gives it back to its button when it closes. The button says when a
// reply is being written.

import { Maximize2, Minimize2, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useT } from "@/i18n";
import { IconLogo } from "@/icons";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

/** The search parameter that says whether and where the chat is open. */
const CHAT_PARAM = "chat";

export type ChatMode = "popup" | "side";

function chatMode(value: string | null): ChatMode | undefined {
  return value === "popup" || value === "side" ? value : undefined;
}

/** Whether and where the page's chat is open, and how to change it. */
export function useChatMode(): [ChatMode | undefined, (next: ChatMode | undefined) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = chatMode(searchParams.get(CHAT_PARAM));
  function setMode(next: ChatMode | undefined) {
    const params = new URLSearchParams(searchParams);
    if (next === undefined) params.delete(CHAT_PARAM);
    else params.set(CHAT_PARAM, next);
    // The open chat is a state of the page, not a step of its history.
    setSearchParams(params, { replace: true });
  }
  return [mode, setMode];
}

/** Where the button and the popup stand, unless the page says otherwise. */
const DEFAULT_ANCHOR = "right-5 bottom-5 md:right-7 md:bottom-7";

export function ChatPanel({
  mode,
  onModeChange,
  title,
  openLabel,
  busy = false,
  actions,
  inputId,
  testId,
  escapeBlocked = false,
  anchor = DEFAULT_ANCHOR,
  scrollKey,
  footer,
  children,
}: {
  mode: ChatMode | undefined;
  onModeChange: (next: ChatMode | undefined) => void;
  /** The panel's heading. */
  title: string;
  /** The accessible name of the button, shown in its tooltip. */
  openLabel: string;
  /** A reply is being written: the button carries a dot. */
  busy?: boolean;
  /** Header actions of the chat itself, before the dock and close actions. */
  actions?: ReactNode;
  /** The id of the field that takes the focus when the panel opens. */
  inputId: string;
  testId: string;
  /** Something open inside the panel answers Esc first. */
  escapeBlocked?: boolean;
  /** Tailwind position classes of the button and the popup. */
  anchor?: string;
  /** Changes whenever the newest message does, so it stays in sight. */
  scrollKey: unknown;
  /** What stands below the conversation: the field to write in. */
  footer: ReactNode;
  /** The conversation. */
  children: ReactNode;
}) {
  const t = useT();
  const headingId = useId();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const opener = useRef<HTMLButtonElement>(null);
  /** Set when the chat closes, so the opener takes the focus back. */
  const returnFocus = useRef(false);

  function close() {
    returnFocus.current = true;
    onModeChange(undefined);
  }

  // The panel takes the focus when it opens or changes its place; the opener
  // gets it back when it closes. The phone's sheet moves the focus itself.
  useEffect(() => {
    if (mode !== undefined && desktop) document.getElementById(inputId)?.focus();
    if (mode === undefined && returnFocus.current) {
      returnFocus.current = false;
      opener.current?.focus();
    }
  }, [mode, desktop, inputId]);

  // The newest message stays in sight as the conversation grows.
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [scrollKey, mode, desktop]);

  const body = (
    <>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {children}
      </div>
      <div className="flex-none border-t border-divider px-4 pt-3 pb-4">{footer}</div>
    </>
  );

  const headerActions = (
    <>
      {desktop && mode !== undefined && (
        <ChatHeaderAction
          label={mode === "side" ? t("chat.collapse") : t("chat.expand")}
          onClick={() => onModeChange(mode === "side" ? "popup" : "side")}
        >
          {mode === "side" ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
        </ChatHeaderAction>
      )}
      {actions}
      <ChatHeaderAction label={t("chat.close")} onClick={close}>
        <X aria-hidden />
      </ChatHeaderAction>
    </>
  );

  // An icon-only brass bubble carrying the logo; its name stands in a tooltip
  // on hover and on keyboard focus (the name itself is the aria-label).
  const button =
    mode === undefined ? (
      <div className={cn("group fixed z-40", anchor)}>
        <Button
          ref={opener}
          type="button"
          onClick={() => onModeChange("popup")}
          aria-label={openLabel}
          className="relative size-12 rounded-[50%_50%_50%_6px] p-0 shadow-popover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        >
          <IconLogo size={22} />
          {busy && (
            <span
              aria-hidden
              className="absolute top-0.5 right-0.5 size-2.5 rounded-full border-2 border-primary bg-primary-foreground motion-safe:animate-pulse"
            />
          )}
        </Button>
        <span
          aria-hidden
          className="pointer-events-none absolute right-0 bottom-full mb-2 hidden w-max max-w-[260px] rounded-md border border-input bg-popover px-2.5 py-1.5 text-[12.5px] leading-[1.4] text-foreground shadow-popover group-hover:block group-has-[:focus-visible]:block"
        >
          {openLabel}
        </span>
      </div>
    ) : null;

  if (!desktop) {
    return (
      <>
        {button}
        <Sheet open={mode !== undefined} onOpenChange={(open) => (open ? onModeChange("popup") : close())}>
          <SheetContent
            side="bottom"
            aria-describedby={undefined}
            data-testid={testId}
            data-mode="sheet"
            className="h-[92dvh] max-h-[92dvh] px-0 pb-0"
          >
            <PanelHeader title={<SheetTitle className="text-[17px]">{title}</SheetTitle>}>
              {headerActions}
            </PanelHeader>
            {body}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  if (mode === undefined) return button;

  return (
    <section
      role="dialog"
      aria-modal={false}
      aria-labelledby={headingId}
      data-testid={testId}
      data-mode={mode}
      onKeyDown={(event) => {
        // Esc closes the popup; a question open inside it answers it first.
        if (event.key === "Escape" && mode === "popup" && !escapeBlocked) {
          event.preventDefault();
          close();
        }
      }}
      className={cn(
        "flex flex-col bg-popover",
        mode === "popup"
          ? cn(
              "fixed z-40 h-[70vh] max-h-[calc(100dvh-5rem)] w-[420px] max-w-[calc(100vw-2rem)] rounded-xl border border-input shadow-popover",
              anchor,
            )
          : // Docked: a column of the page, as tall as the area below the
            // topbar, standing still while the page scrolls.
            "sticky top-0 h-[calc(100dvh-3.5rem)] w-[420px] flex-none self-start border-l border-border",
      )}
    >
      <PanelHeader
        title={
          <h2 id={headingId} className="font-serif text-[17px] leading-[1.3] font-semibold text-foreground">
            {title}
          </h2>
        }
      >
        {headerActions}
      </PanelHeader>
      {body}
    </section>
  );
}

function PanelHeader({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-none items-center gap-1 border-b border-divider px-4 pt-1 pb-2.5 md:pt-3">
      <div className="min-w-0 flex-1">{title}</div>
      {children}
    </div>
  );
}

/** An icon action in the chat's header; its label is its name and its tooltip. */
export function ChatHeaderAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
      className="size-9 flex-none p-0 text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-4"
    >
      {children}
    </Button>
  );
}
