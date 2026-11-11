// The brainstorming chat of ONE scene, opened from its button at the bottom
// right of the scene's reading view: the conversation so far, the reply being
// written, and the field the DM writes the next message in.
//
// The frame — the button, the popup that docks as a side panel, the sheet on
// the phone — and the messages and the field are the shared chat parts
// (components/ChatPanel.tsx, components/ChatMessage.tsx); where the chat
// stands lives in the URL, so a reload keeps it.
//
// The chat is its own resource (decisions/resources): a scene has at most one
// live chat, started with the first message and kept on the server across
// visits, devices and restarts — nothing of it lives in the browser. Sending
// answers at once with the DM's message; the reply is written on the server,
// and the chat's query polls until it stands (./scene-chat-query.ts). While a
// reply runs the send action waits: one reply per scene at a time.
//
// A failed reply says why in a whole sentence and offers to ask again; the
// DM's message stays. Clearing asks first and puts the whole chat in the
// trash, from where the notice's undo or the trash page brings it back.
// Without a configured model, a sentence stands where the send action would
// be.

import type { SceneChat as SceneChatType } from "@grimoire/shared/scene-chat";
import type { SceneChatMessage } from "@grimoire/shared/scene-chat-message";
import { TRASH_RETENTION_DAYS } from "@grimoire/shared/trash";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { ChatComposer, ChatMessage } from "@/components/ChatMessage";
import { ChatHeaderAction, ChatPanel, useChatMode } from "@/components/ChatPanel";
import { showNotice, showUndoNotice } from "@/components/Notices";
import { TrashDialog } from "@/components/TrashDialog";
import { useT } from "@/i18n";
import { serverErrorBodyMessage, serverErrorMessage } from "@/i18n/server-errors";

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
  const inputId = useId();
  const [mode, setMode] = useChatMode();
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
  const canClear = chat.data !== null && chat.data !== undefined && messages.length > 0;

  const footer =
    provider.data?.configured === false ? (
      <p
        data-testid="scene-chat-unconfigured"
        className="rounded-lg border border-input bg-card px-4 py-3 text-[13.5px] leading-[1.6] text-body-secondary"
      >
        {t("sceneChat.unconfigured")}
      </p>
    ) : (
      <ChatComposer
        id={inputId}
        value={draft}
        onChange={setDraft}
        onSend={() => send.mutate(text)}
        canSend={canSend}
        sending={send.isPending}
        placeholder={t("sceneChat.input.placeholder")}
        error={send.isError ? serverErrorMessage(send.error, t, "sceneChat.send.failed") : undefined}
      />
    );

  return (
    <ChatPanel
      mode={mode}
      onModeChange={setMode}
      title={t("sceneChat.heading")}
      openLabel={running ? t("sceneChat.open.running") : t("sceneChat.open")}
      busy={running}
      inputId={inputId}
      testId="scene-chat"
      escapeBlocked={confirmClear}
      scrollKey={`${messages.length}:${messages.at(-1)?.status}`}
      actions={
        canClear && (
          <ChatHeaderAction
            label={t("sceneChat.clear")}
            disabled={running || clear.isPending}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 aria-hidden />
          </ChatHeaderAction>
        )
      }
      footer={footer}
    >
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
              testId="scene-chat-message"
              failure={serverErrorBodyMessage(message.error, t)}
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
    </ChatPanel>
  );
}

const NOTE = "text-[14px] text-muted-foreground";
