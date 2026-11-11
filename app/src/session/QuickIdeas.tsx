// The quick-ideas chat of the running session, opened from its button at the
// bottom right of the live view: the DM asks the model for an idea at the
// table — a name, a reaction, a twist — about the scene that is open.
//
// The frame — the button, the popup that docks as a side panel — and the
// messages and the field are the shared chat parts (components/ChatPanel.tsx,
// components/ChatMessage.tsx).
//
// NOTHING IS STORED (decisions/generator). The conversation is this
// component's state and nothing else: no row, no query cache, no browser
// storage — a reload or leaving the live view ends it, and the chat says so
// before the first question. Every question sends the whole conversation and
// the scene open at that moment; the server reads the rest of the context
// fresh and answers in the same request. While it runs the send action
// waits. A reply that cannot be used says why in a whole sentence, the DM's
// question stays, and the reply can be asked for again.

import { useId, useRef, useState } from "react";

import type { QuickIdeasTurn } from "@grimoire/shared/quick-ideas";

import { ApiError } from "@/api";
import { ChatComposer, ChatMessage, type ChatMessageView } from "@/components/ChatMessage";
import { ChatPanel, useChatMode } from "@/components/ChatPanel";
import { useT } from "@/i18n";
import { serverErrorMessage } from "@/i18n/server-errors";
import type { Translate } from "@/i18n/format";

import { askQuickIdeas } from "./quick-ideas-api";

/** One message of the conversation, with what the view needs beside it. */
interface Message extends ChatMessageView {
  /** A key of its own, stable while the conversation grows. */
  key: number;
  /** Why a failed reply is not there: the error the question answered. */
  error?: unknown;
}

/** The turns a question sends: every written message, no reply that failed or runs. */
function turnsOf(messages: readonly Message[]): QuickIdeasTurn[] {
  return messages
    .filter((message) => message.status === "done")
    .map((message) => ({ role: message.role, text: message.text }));
}

/** The sentence of a failed reply. */
function failureSentence(error: unknown, t: Translate): string {
  if (error instanceof ApiError && error.details?.code === "session_ended") return t("quickIdeas.ended");
  return serverErrorMessage(error, t, "quickIdeas.unreachable");
}

export function QuickIdeas({
  campaign,
  session,
  scene,
  anchor,
}: {
  campaign: string;
  /** The running session the questions are asked in. */
  session: string;
  /** The scene open in the live view, whose context every question carries. */
  scene: string | undefined;
  /** Where the button and the popup stand (components/ChatPanel.tsx). */
  anchor?: string;
}) {
  const t = useT();
  const inputId = useId();
  const [mode, setMode] = useChatMode();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const nextKey = useRef(0);

  const running = messages.some((message) => message.status === "running");
  const text = draft.trim();
  const canSend = scene !== undefined && !running && text !== "";

  /** Ask for the reply `replyKey` with the conversation before it. */
  function ask(replyKey: number, before: readonly Message[]) {
    if (scene === undefined) return;
    const settle = (patch: Partial<Message>) =>
      setMessages((current) =>
        current.map((message) => (message.key === replyKey ? { ...message, ...patch } : message)),
      );
    askQuickIdeas(campaign, session, { scene, messages: turnsOf(before) }).then(
      (reply) => settle({ status: "done", text: reply.text, error: undefined }),
      (error: unknown) => settle({ status: "failed", text: "", error }),
    );
  }

  function send() {
    const question: Message = { key: nextKey.current++, role: "dm", status: "done", text };
    const reply: Message = { key: nextKey.current++, role: "model", status: "running", text: "" };
    const before = [...messages, question];
    setMessages([...before, reply]);
    setDraft("");
    ask(reply.key, before);
  }

  function retry(failed: Message) {
    const index = messages.findIndex((message) => message.key === failed.key);
    setMessages((current) =>
      current.map((message) =>
        message.key === failed.key ? { ...message, status: "running", error: undefined } : message,
      ),
    );
    ask(failed.key, messages.slice(0, index));
  }

  return (
    <ChatPanel
      mode={mode}
      onModeChange={setMode}
      title={t("quickIdeas.heading")}
      openLabel={running ? t("quickIdeas.open.running") : t("quickIdeas.open")}
      busy={running}
      inputId={inputId}
      testId="quick-ideas"
      anchor={anchor}
      scrollKey={`${messages.length}:${messages.at(-1)?.status}`}
      footer={
        <ChatComposer
          id={inputId}
          value={draft}
          onChange={setDraft}
          onSend={send}
          canSend={canSend}
          placeholder={t("quickIdeas.input.placeholder")}
        />
      }
    >
      {messages.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] leading-[1.6] text-body-secondary">{t("quickIdeas.lead")}</p>
          <p className="rounded-lg border border-dashed border-input px-4 py-5 text-center text-[13.5px] leading-[1.6] text-muted-foreground">
            {t("quickIdeas.empty")}
          </p>
        </div>
      ) : (
        <ol aria-label={t("quickIdeas.log")} className="flex flex-col gap-4">
          {messages.map((message) => (
            <ChatMessage
              key={message.key}
              message={message}
              testId="quick-ideas-message"
              failure={message.status === "failed" ? failureSentence(message.error, t) : undefined}
              retrying={false}
              retryError={undefined}
              canRetry={!running && scene !== undefined}
              onRetry={() => retry(message)}
            />
          ))}
        </ol>
      )}
    </ChatPanel>
  );
}
