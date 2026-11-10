// The brainstorming chat of ONE scene, opened from its button at the bottom
// right of the scene's reading view: the conversation so far, the reply being
// written, and the field the DM writes the next message in.
//
// WHERE it stands is the DM's choice and lives in the URL (`?chat=popup` or
// `?chat=side`), so a reload keeps it and nothing is stored in the browser:
//
//   popup  a floating panel above the page, anchored bottom right; the page
//          behind it stays scrollable and usable. Esc closes it.
//   side   docked as a column at the right of the page, the full height below
//          the topbar; the page narrows to make room for it.
//   phone  either way a sheet from the bottom edge, nearly the whole screen.
//
// The panel takes the focus when it opens and gives it back to its button
// when it closes. The button says when a reply is being written.
//
// The chat is its own resource (decisions/resources): a scene has at most one
// live chat, started with the first message and kept on the server across
// visits, devices and restarts — nothing of it lives in the browser. Sending
// answers at once with the DM's message; the reply is written on the server,
// and the chat's query polls until it stands (./scene-chat-query.ts). While a
// reply runs the send action waits: one reply per scene at a time.
//
// A reply is Markdown and is drawn with the app's renderer, so an `[[id]]` in
// it resolves like everywhere else; it has a copy action. A failed reply says
// why in a whole sentence and offers to ask again; the DM's message stays.
// Clearing asks first and puts the whole chat in the trash, from where the
// notice's undo or the trash page brings it back. Without a configured
// model, a sentence stands where the send action would be.

import type { SceneChat as SceneChatType } from "@grimoire/shared/scene-chat";
import type { SceneChatMessage } from "@grimoire/shared/scene-chat-message";
import { TRASH_RETENTION_DAYS } from "@grimoire/shared/trash";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Maximize2, Minimize2, Trash2, X } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router";

import { showNotice, showUndoNotice } from "@/components/Notices";
import { TrashDialog } from "@/components/TrashDialog";
import { AutoGrowTextarea } from "@/components/ui/autogrow-textarea";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useT } from "@/i18n";
import { IconLogo } from "@/icons";
import { serverErrorBodyMessage, serverErrorMessage } from "@/i18n/server-errors";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { Markdown } from "@/markdown/Markdown";

import { clearSceneChat, restoreSceneChat, startSceneChat } from "./scene-chat-api";
import { retrySceneChatReply, sendSceneChatMessage } from "./scene-chat-message-api";
import {
  llmProviderQuery,
  replyRunning,
  sceneChatKey,
  sceneChatQuery,
  sceneChatTrashKey,
} from "./scene-chat-query";

/** The search parameter that says whether and where the chat is open. */
const CHAT_PARAM = "chat";
type ChatMode = "popup" | "side";

function chatMode(value: string | null): ChatMode | undefined {
  return value === "popup" || value === "side" ? value : undefined;
}

export function SceneChat({ campaign, scene }: { campaign: string; scene: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const headingId = useId();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = chatMode(searchParams.get(CHAT_PARAM));
  const key = sceneChatKey(campaign, scene);
  const chat = useQuery({ ...sceneChatQuery(campaign, scene), enabled: campaign !== "" && scene !== "" });
  const provider = useQuery(llmProviderQuery());
  const [draft, setDraft] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  /** Set when the chat closes, so the opener takes the focus back. */
  const returnFocus = useRef(false);

  // A new scene is a new conversation: the draft of another one does not
  // follow the DM there.
  useEffect(() => {
    setDraft("");
    setConfirmClear(false);
  }, [campaign, scene]);

  function setMode(next: ChatMode | undefined) {
    const params = new URLSearchParams(searchParams);
    if (next === undefined) params.delete(CHAT_PARAM);
    else params.set(CHAT_PARAM, next);
    // The open chat is a state of the page, not a step of its history.
    setSearchParams(params, { replace: true });
  }

  function close() {
    returnFocus.current = true;
    setMode(undefined);
  }

  // The panel takes the focus when it opens or changes its place; the opener
  // gets it back when it closes. The phone's sheet moves the focus itself.
  useEffect(() => {
    if (mode !== undefined && desktop) document.getElementById(`${headingId}-input`)?.focus();
    if (mode === undefined && returnFocus.current) {
      returnFocus.current = false;
      opener.current?.focus();
    }
  }, [mode, desktop, headingId]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const send = useMutation({
    mutationFn: async (text: string) => {
      const current = chat.data ?? (await startSceneChat(campaign, scene));
      return sendSceneChatMessage(campaign, current.id, text);
    },
    onSuccess: async () => {
      setDraft("");
      await refresh();
    },
    // A refusal (a reply running elsewhere, a chat cleared meanwhile) leaves
    // the draft where it is, and the chat is read again.
    onError: () => void refresh(),
  });

  const retry = useMutation({
    mutationFn: (reply: SceneChatMessage) => retrySceneChatReply(campaign, chat.data!.id, reply),
    onSettled: () => void refresh(),
  });

  const clear = useMutation({
    mutationFn: (current: SceneChatType) => clearSceneChat(campaign, current),
    onSuccess: (cleared) => {
      setConfirmClear(false);
      queryClient.setQueryData(key, null);
      void queryClient.invalidateQueries({ queryKey: sceneChatTrashKey(campaign) });
      showUndoNotice({
        message: t("sceneChat.cleared"),
        undoLabel: t("notice.undo"),
        onUndo: () => {
          restoreSceneChat(campaign, cleared).then(
            () => {
              void refresh();
              void queryClient.invalidateQueries({ queryKey: sceneChatTrashKey(campaign) });
            },
            (error: unknown) => showNotice(serverErrorMessage(error, t, "trash.restore.failed")),
          );
        },
      });
    },
    onError: () => void refresh(),
  });

  const messages = chat.data?.messages ?? [];
  const running = replyRunning(chat.data);
  const configured = provider.data?.configured !== false;
  const text = draft.trim();
  const canSend = configured && !running && !send.isPending && text !== "" && chat.isSuccess;
  const canClear = chat.data !== null && chat.data !== undefined && messages.length > 0;

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (canSend) send.mutate(text);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // ⌘/Ctrl+Enter sends; a plain Enter is a new line of the message.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
  }

  // The newest message stays in sight as the conversation grows.
  const scroller = useRef<HTMLDivElement>(null);
  const lastStatus = messages.at(-1)?.status;
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [messages.length, lastStatus, mode, desktop]);

  const body = (
    <>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {chat.isPending ? (
          <p className={NOTE}>{t("sceneChat.loading")}</p>
        ) : chat.data === undefined ? (
          <p className={NOTE}>{t("sceneChat.loadFailed")}</p>
        ) : messages.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] leading-[1.6] text-body-secondary">{t("sceneChat.lead")}</p>
            <p className="rounded-lg border border-dashed border-input px-4 py-5 text-center text-[13.5px] leading-[1.6] text-muted-foreground">
              {t("sceneChat.empty")}
            </p>
          </div>
        ) : (
          <ol aria-label={t("sceneChat.log")} className="flex flex-col gap-4">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                retrying={retry.isPending}
                retryError={
                  retry.isError && retry.variables?.id === message.id
                    ? serverErrorMessage(retry.error, t, "sceneChat.retry.failed")
                    : undefined
                }
                canRetry={configured && !running}
                onRetry={() => retry.mutate(message)}
              />
            ))}
          </ol>
        )}
        {running && (
          <p role="status" className="mt-3 text-[12.5px] leading-[1.5] text-muted-foreground">
            {t("sceneChat.running.hint")}
          </p>
        )}
      </div>

      <div className="flex-none border-t border-divider px-4 pt-3 pb-4">
        {provider.data?.configured === false ? (
          <p
            data-testid="scene-chat-unconfigured"
            className="rounded-lg border border-input bg-card px-4 py-3 text-[13.5px] leading-[1.6] text-body-secondary"
          >
            {t("sceneChat.unconfigured")}
          </p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-2">
            <label htmlFor={`${headingId}-input`} className="sr-only">
              {t("sceneChat.input.label")}
            </label>
            <AutoGrowTextarea
              id={`${headingId}-input`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t("sceneChat.input.placeholder")}
              minRows={2}
              className="max-h-[30vh]"
            />
            {send.isError && (
              <p aria-live="polite" className="text-[12.5px] leading-[1.5] text-destructive">
                {serverErrorMessage(send.error, t, "sceneChat.send.failed")}
              </p>
            )}
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={!canSend}
                className="h-auto min-h-9 px-4 py-1.5 text-[13px] font-semibold"
              >
                {send.isPending ? t("sceneChat.sending") : t("sceneChat.send")}
              </Button>
            </div>
          </form>
        )}
      </div>

      {confirmClear && canClear && (
        <TrashDialog
          title={t("sceneChat.clear.title")}
          sentences={[t("sceneChat.clear.sentence", { days: TRASH_RETENTION_DAYS })]}
          unsaved={false}
          error={clear.isError ? serverErrorMessage(clear.error, t, "sceneChat.clear.failed") : undefined}
          busy={clear.isPending}
          onConfirm={() => clear.mutate(chat.data!)}
          onCancel={() => {
            setConfirmClear(false);
            clear.reset();
          }}
        />
      )}
    </>
  );

  const actions = (
    <>
      {desktop && mode !== undefined && (
        <HeaderAction
          label={mode === "side" ? t("sceneChat.collapse") : t("sceneChat.expand")}
          onClick={() => setMode(mode === "side" ? "popup" : "side")}
        >
          {mode === "side" ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
        </HeaderAction>
      )}
      {canClear && (
        <HeaderAction
          label={t("sceneChat.clear")}
          disabled={running || clear.isPending}
          onClick={() => setConfirmClear(true)}
        >
          <Trash2 aria-hidden />
        </HeaderAction>
      )}
      <HeaderAction label={t("sceneChat.close")} onClick={close}>
        <X aria-hidden />
      </HeaderAction>
    </>
  );

  const openLabel = running ? t("sceneChat.open.running") : t("sceneChat.open");
  // An icon-only brass bubble carrying the logo; its name stands in a tooltip
  // on hover and on keyboard focus (the name itself is the aria-label).
  const button =
    mode === undefined ? (
      <div className="group fixed right-5 bottom-5 z-40 md:right-7 md:bottom-7">
        <Button
          ref={opener}
          type="button"
          onClick={() => setMode("popup")}
          aria-label={openLabel}
          className="relative size-12 rounded-[50%_50%_50%_6px] p-0 shadow-popover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        >
          <IconLogo size={22} />
          {running && (
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
        <Sheet open={mode !== undefined} onOpenChange={(open) => (open ? setMode("popup") : close())}>
          <SheetContent
            side="bottom"
            aria-describedby={undefined}
            data-testid="scene-chat"
            data-mode="sheet"
            className="h-[92dvh] max-h-[92dvh] px-0 pb-0"
          >
            <PanelHeader title={<SheetTitle className="text-[17px]">{t("sceneChat.heading")}</SheetTitle>}>
              {actions}
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
      data-testid="scene-chat"
      data-mode={mode}
      onKeyDown={(event) => {
        // Esc closes the popup; a question open inside it answers it first.
        if (event.key === "Escape" && mode === "popup" && !confirmClear) {
          event.preventDefault();
          close();
        }
      }}
      className={cn(
        "flex flex-col bg-popover",
        mode === "popup"
          ? "fixed right-7 bottom-7 z-40 h-[70vh] max-h-[calc(100dvh-5rem)] w-[420px] max-w-[calc(100vw-2rem)] rounded-xl border border-input shadow-popover"
          : // Docked: a column of the page, as tall as the area below the
            // topbar, standing still while the page scrolls.
            "sticky top-0 h-[calc(100dvh-3.5rem)] w-[420px] flex-none self-start border-l border-border",
      )}
    >
      <PanelHeader
        title={
          <h2 id={headingId} className="font-serif text-[17px] leading-[1.3] font-semibold text-foreground">
            {t("sceneChat.heading")}
          </h2>
        }
      >
        {actions}
      </PanelHeader>
      {body}
    </section>
  );
}

const NOTE = "text-[14px] text-muted-foreground";

function PanelHeader({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-none items-center gap-1 border-b border-divider px-4 pt-1 pb-2.5 md:pt-3">
      <div className="min-w-0 flex-1">{title}</div>
      {children}
    </div>
  );
}

function HeaderAction({
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

function ChatMessage({
  message,
  retrying,
  retryError,
  canRetry,
  onRetry,
}: {
  message: SceneChatMessage;
  retrying: boolean;
  retryError: string | undefined;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const t = useT();
  const fromDm = message.role === "dm";
  return (
    <li
      data-testid="scene-chat-message"
      data-role={message.role}
      data-status={message.status}
      className={
        fromDm
          ? "ml-auto max-w-[88%] rounded-lg bg-card px-4 py-3 md:max-w-[80%]"
          : "group relative rounded-lg border border-input px-4 py-3"
      }
    >
      <p className="mb-1 text-[11px] font-semibold tracking-[.08em] text-muted-foreground uppercase">
        {fromDm ? t("sceneChat.role.dm") : t("sceneChat.role.model")}
      </p>
      {fromDm ? (
        <p className="text-[14.5px] leading-[1.6] break-words whitespace-pre-wrap text-foreground">{message.text}</p>
      ) : message.status === "running" ? (
        <p className="text-[14px] text-muted-foreground motion-safe:animate-pulse">{t("sceneChat.running")}</p>
      ) : message.status === "failed" ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13.5px] leading-[1.6] text-destructive">
            {serverErrorBodyMessage(message.error, t) ?? t("sceneChat.failed.fallback")}
          </p>
          <p className="text-[12.5px] leading-[1.5] text-muted-foreground">{t("sceneChat.failed.hint")}</p>
          {retryError !== undefined && (
            <p aria-live="polite" className="text-[12.5px] leading-[1.5] text-destructive">
              {retryError}
            </p>
          )}
          <div>
            <Button
              type="button"
              variant="outline"
              disabled={!canRetry || retrying}
              onClick={onRetry}
              className="h-auto min-h-9 border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
            >
              {t("sceneChat.retry")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="min-w-0 overflow-x-auto">
            <Markdown>{message.text}</Markdown>
          </div>
          <div className="mt-2 flex justify-end">
            <CopyReply text={message.text} />
          </div>
        </>
      )}
    </li>
  );
}

/** The copy action of a reply: its Markdown text, as the model wrote it. */
function CopyReply({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable (permissions, insecure context) — stay quiet.
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={copy}
      aria-label={copied ? t("sceneChat.copied.aria") : t("sceneChat.copy.aria")}
      className="h-auto min-h-8 gap-1.5 rounded-md border-input bg-transparent px-2.5 py-[5px] text-[12px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground [&_svg]:size-[13px]"
    >
      {copied ? <Check aria-hidden className="text-success" /> : <Copy aria-hidden />}
      {copied ? t("sceneChat.copied") : t("sceneChat.copy")}
    </Button>
  );
}
