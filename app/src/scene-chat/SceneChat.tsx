// The brainstorming chat of ONE scene, below its reading view: the
// conversation so far, the reply being written, and the field the DM writes
// the next message in.
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
import { Check, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { showNotice, showUndoNotice } from "@/components/Notices";
import { TrashDialog } from "@/components/TrashDialog";
import { AutoGrowTextarea } from "@/components/ui/autogrow-textarea";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { serverErrorBodyMessage, serverErrorMessage } from "@/i18n/server-errors";
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

export function SceneChat({ campaign, scene }: { campaign: string; scene: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const headingId = useId();
  const key = sceneChatKey(campaign, scene);
  const chat = useQuery({ ...sceneChatQuery(campaign, scene), enabled: campaign !== "" && scene !== "" });
  const provider = useQuery(llmProviderQuery());
  const [draft, setDraft] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  // A new scene is a new conversation: the draft of another one does not
  // follow the DM there.
  useEffect(() => {
    setDraft("");
    setConfirmClear(false);
  }, [campaign, scene]);

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

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (canSend) send.mutate(text);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // ⌘/Ctrl+Enter sends; a plain Enter is a new line of the message.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="scene-chat"
      className="mt-12 border-t border-divider pt-8"
    >
      <div className="mb-1.5 flex items-center gap-3">
        <h2 id={headingId} className="flex-1 font-serif text-[20px] leading-[1.3] font-semibold text-foreground">
          {t("sceneChat.heading")}
        </h2>
        {chat.data !== null && chat.data !== undefined && messages.length > 0 && (
          <Button
            type="button"
            variant="outline"
            disabled={running || clear.isPending}
            onClick={() => setConfirmClear(true)}
            className="h-auto min-h-9 flex-none border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
          >
            {t("sceneChat.clear")}
          </Button>
        )}
      </div>
      <p className="mb-5 max-w-[62ch] text-[13px] leading-[1.6] text-body-secondary">{t("sceneChat.lead")}</p>

      {chat.isPending ? (
        <p className={NOTE}>{t("sceneChat.loading")}</p>
      ) : chat.data === undefined ? (
        <p className={NOTE}>{t("sceneChat.loadFailed")}</p>
      ) : messages.length === 0 ? (
        <p className="rounded-lg border border-dashed border-input px-5 py-6 text-center text-[13.5px] leading-[1.6] text-muted-foreground">
          {t("sceneChat.empty")}
        </p>
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

      {provider.data?.configured === false ? (
        <p data-testid="scene-chat-unconfigured" className="mt-5 rounded-lg border border-input bg-card px-4 py-3 text-[13.5px] leading-[1.6] text-body-secondary">
          {t("sceneChat.unconfigured")}
        </p>
      ) : (
        <form onSubmit={submit} className="mt-5 flex flex-col gap-2">
          <label htmlFor={`${headingId}-input`} className="sr-only">
            {t("sceneChat.input.label")}
          </label>
          <AutoGrowTextarea
            id={`${headingId}-input`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("sceneChat.input.placeholder")}
            minRows={3}
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

      {confirmClear && chat.data !== null && chat.data !== undefined && (
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
    </section>
  );
}

const NOTE = "text-[14px] text-muted-foreground";

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
