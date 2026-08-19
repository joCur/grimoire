// Rendering for the six known callout kinds (CALLOUT_KINDS). Unknown kinds
// never reach this component — the remark plugin leaves them as plain
// blockquotes. The read-aloud block is the signature element (UI-BRIEF):
// a "book page in the interface" with a serif face, a thin brass ribbon
// line, and a copy button for the Roll20 chat.

import { CALLOUT_KINDS, type CalloutKind } from "@grimoire/shared/types";
import {
  BookOpenText,
  Check,
  Copy,
  Dices,
  Eye,
  Flag,
  Package,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Lucide icons as functional placeholders; the thematic game-icons.net
// markers (DECISIONS.md #5) land with the design delivery.
const META: Record<CalloutKind, { label: string; icon: LucideIcon }> = {
  readaloud: { label: "Vorlesen", icon: BookOpenText },
  check: { label: "Probe", icon: Dices },
  secret: { label: "Geheim", icon: Eye },
  outcome: { label: "Folge", icon: Flag },
  loot: { label: "Beute", icon: Package },
  note: { label: "Notiz", icon: StickyNote },
};

const KIND_CLASSES: Record<Exclude<CalloutKind, "readaloud">, string> = {
  check: "border-primary/60",
  secret: "bg-background text-muted-foreground",
  outcome: "",
  loot: "",
  note: "",
};

function isCalloutKind(kind: string): kind is CalloutKind {
  return (CALLOUT_KINDS as readonly string[]).includes(kind);
}

interface CalloutProps {
  kind: string;
  copyText?: string | undefined;
  children?: ReactNode;
}

export function Callout({ kind, copyText, children }: CalloutProps) {
  // Defensive degrade: the plugin only tags known kinds, but if an unknown
  // one ever arrives here it still renders as a plain blockquote.
  if (!isCalloutKind(kind)) return <blockquote>{children}</blockquote>;
  if (kind === "readaloud") return <ReadAloud copyText={copyText}>{children}</ReadAloud>;

  const { label, icon: Icon } = META[kind];
  return (
    <section
      data-callout={kind}
      className={cn("rounded-md border bg-card px-4 py-3", KIND_CLASSES[kind])}
    >
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Icon aria-hidden className="size-3.5" />
        {label}
      </p>
      <div className="space-y-2 text-[0.95rem]">{children}</div>
    </section>
  );
}

function ReadAloud({ copyText, children }: { copyText?: string | undefined; children?: ReactNode }) {
  return (
    <aside
      data-callout="readaloud"
      className="group relative rounded-md border border-border/60 border-l-2 border-l-primary bg-readaloud px-5 py-4 text-readaloud-foreground"
    >
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <BookOpenText aria-hidden className="size-3.5" />
        Vorlesen
      </p>
      {copyText !== undefined && <CopyButton text={copyText} />}
      <div className="space-y-3 font-serif text-[1.1875rem] leading-[1.75]">{children}</div>
    </aside>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions, insecure context) — stay quiet.
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={copy}
      aria-label={copied ? "Vorlesetext kopiert" : "Vorlesetext kopieren"}
      title="Vorlesetext kopieren"
      className="absolute right-2.5 top-2.5 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
    >
      {copied ? <Check aria-hidden className="text-success" /> : <Copy aria-hidden />}
    </Button>
  );
}
