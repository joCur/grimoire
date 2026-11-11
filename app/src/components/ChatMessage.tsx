// The parts of a chat with the model inside its panel (./ChatPanel.tsx),
// without knowledge of what the chat is about: one message of the
// conversation, the copy action of a reply, and the field the DM writes in.
//
// A reply is Markdown and is drawn with the app's renderer, so an `[[id]]` in
// it resolves like everywhere else; it has a copy action. A failed reply says
// why in a whole sentence — the chat hands that sentence in — and offers to
// ask again; the DM's message stays.

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { AutoGrowTextarea } from "@/components/ui/autogrow-textarea";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { Markdown } from "@/markdown/Markdown";

/** One message as the conversation shows it. */
export interface ChatMessageView {
  role: "dm" | "model";
  /** `running` while the reply is being written, `failed` when it was not. */
  status: "done" | "running" | "failed";
  /** The text, Markdown; empty while a reply runs or after it failed. */
  text: string;
}

export function ChatMessage({
  message,
  testId,
  failure,
  retrying,
  retryError,
  canRetry,
  onRetry,
}: {
  message: ChatMessageView;
  testId: string;
  /** Why a failed reply is not there, as a whole sentence. */
  failure?: string;
  retrying: boolean;
  retryError: string | undefined;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const t = useT();
  const fromDm = message.role === "dm";
  return (
    <li
      data-testid={testId}
      data-role={message.role}
      data-status={message.status}
      className={
        fromDm
          ? "ml-auto max-w-[88%] rounded-lg bg-card px-4 py-3 md:max-w-[80%]"
          : "group relative rounded-lg border border-input px-4 py-3"
      }
    >
      <p className="mb-1 text-[11px] font-semibold tracking-[.08em] text-muted-foreground uppercase">
        {fromDm ? t("chat.role.dm") : t("chat.role.model")}
      </p>
      {fromDm ? (
        <p className="text-[14.5px] leading-[1.6] break-words whitespace-pre-wrap text-foreground">{message.text}</p>
      ) : message.status === "running" ? (
        <p className="text-[14px] text-muted-foreground motion-safe:animate-pulse">{t("chat.running")}</p>
      ) : message.status === "failed" ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13.5px] leading-[1.6] text-destructive">{failure ?? t("chat.failed.fallback")}</p>
          <p className="text-[12.5px] leading-[1.5] text-muted-foreground">{t("chat.failed.hint")}</p>
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
              {t("chat.retry")}
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
      aria-label={copied ? t("chat.copied.aria") : t("chat.copy.aria")}
      className="h-auto min-h-8 gap-1.5 rounded-md border-input bg-transparent px-2.5 py-[5px] text-[12px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground [&_svg]:size-[13px]"
    >
      {copied ? <Check aria-hidden className="text-success" /> : <Copy aria-hidden />}
      {copied ? t("chat.copied") : t("chat.copy")}
    </Button>
  );
}

/**
 * The field the DM writes the next message in, and its send action.
 * ⌘/Ctrl+Enter sends; a plain Enter is a new line of the message.
 */
export function ChatComposer({
  id,
  value,
  onChange,
  onSend,
  canSend,
  sending = false,
  placeholder,
  error,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Called only while `canSend`. */
  onSend: () => void;
  canSend: boolean;
  /** The message is on its way: the send action says so. */
  sending?: boolean;
  placeholder: string;
  /** Why the last message was not sent, as a whole sentence. */
  error?: string;
}) {
  const t = useT();

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (canSend) onSend();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={id} className="sr-only">
        {t("chat.input.label")}
      </label>
      <AutoGrowTextarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        minRows={2}
        className="max-h-[30vh]"
      />
      {error !== undefined && (
        <p aria-live="polite" className="text-[12.5px] leading-[1.5] text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={!canSend} className="h-auto min-h-9 px-4 py-1.5 text-[13px] font-semibold">
          {sending ? t("chat.sending") : t("chat.send")}
        </Button>
      </div>
    </form>
  );
}
