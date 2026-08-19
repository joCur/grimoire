// Rendering for the six known callout kinds (CALLOUT_KINDS). Unknown kinds
// never reach this component — the remark plugin leaves them as plain
// blockquotes. Anatomy and pixel values come from the design reference
// (design/Grimoire.dc.html): a flex row with the type marker left and an
// 11px uppercase label above the 14px text; per-kind colors via tokens.
//
// The read-aloud block is the signature element and has NO label row:
// a "book page in the interface" — readaloud background, 3px brass ribbon
// left, Literata 19px, and a quiet copy button (for the Roll20 chat) that
// only surfaces on hover/focus.

import { CALLOUT_KINDS, type CalloutKind } from "@grimoire/shared/types";
import { Check, Copy, CornerDownRight, Dice3, Eye, Gem, PenLine } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Labels per the prototype's calloutMeta(); markers are the closest lucide
// glyphs (Dice3/Eye/CornerDownRight/Gem/PenLine match the prototype's own
// stroke SVGs closely enough — DECISIONS #5: lucide first).
const META: Record<Exclude<CalloutKind, "readaloud">, { label: string; icon: ReactNode }> = {
  check: { label: "Check", icon: <Dice3 aria-hidden size={17} /> },
  secret: { label: "Geheim", icon: <Eye aria-hidden size={17} /> },
  outcome: { label: "Konsequenz", icon: <CornerDownRight aria-hidden size={17} /> },
  loot: { label: "Beute", icon: <Gem aria-hidden size={17} /> },
  note: { label: "Notiz", icon: <PenLine aria-hidden size={16} /> },
};

// Per-kind colors, straight from the prototype's calloutMeta().
const KIND_CLASSES: Record<
  Exclude<CalloutKind, "readaloud">,
  { box: string; icon: string; label: string; body: string }
> = {
  check: {
    box: "border-[color-mix(in_srgb,var(--primary)_45%,transparent)] bg-[color-mix(in_srgb,var(--primary)_7%,transparent)]",
    icon: "text-primary",
    label: "text-primary-hover",
    body: "text-foreground",
  },
  secret: {
    box: "border-secret-border bg-secret",
    icon: "text-dim",
    label: "text-dim",
    body: "text-body-secondary",
  },
  outcome: {
    box: "border-input bg-card",
    icon: "text-soft",
    label: "text-soft",
    body: "text-body",
  },
  loot: {
    box: "border-input bg-card",
    icon: "text-soft",
    label: "text-soft",
    body: "text-body",
  },
  note: {
    box: "border-border bg-transparent",
    icon: "text-muted-foreground",
    label: "text-muted-foreground",
    body: "text-body-secondary",
  },
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

  const { label, icon } = META[kind];
  const colors = KIND_CLASSES[kind];
  return (
    <section
      data-callout={kind}
      className={cn(
        "mt-[6px] mb-3.5 flex items-start gap-3 rounded-[6px] border px-3.5 py-3",
        colors.box,
      )}
    >
      <span aria-hidden className={cn("mt-px flex-none", colors.icon)}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className={cn("mb-1 text-[11px] font-semibold tracking-[.08em] uppercase", colors.label)}>
          {label}
        </p>
        <div className={cn("text-[14px] leading-[1.6] [&_p]:m-0 [&_p+p]:mt-3", colors.body)}>
          {children}
        </div>
      </div>
    </section>
  );
}

function ReadAloud({ copyText, children }: { copyText?: string | undefined; children?: ReactNode }) {
  return (
    <aside
      data-callout="readaloud"
      className="group relative mt-[6px] mb-[18px] rounded-[4px] border-l-[3px] border-l-primary bg-readaloud px-6 py-5"
    >
      <div className="font-serif text-[19px] leading-[1.75] text-readaloud-foreground [&_p]:m-0 [&_p+p]:mt-3">
        {children}
      </div>
      {copyText !== undefined && <CopyButton text={copyText} />}
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
      data-copied={copied ? "" : undefined}
      aria-label={copied ? "Vorlesetext kopiert" : "Vorlesetext kopieren"}
      className="absolute top-2.5 right-2.5 h-auto gap-1.5 rounded-md border-input bg-background px-2.5 py-[5px] font-sans text-[12px] font-normal text-body-secondary opacity-25 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:border-border-hover hover:bg-background hover:text-foreground focus-visible:opacity-100 data-copied:opacity-100 [&_svg]:size-[13px]"
    >
      {copied ? (
        <Check aria-hidden className="text-success" />
      ) : (
        <Copy aria-hidden />
      )}
      {copied ? "Kopiert" : "Kopieren"}
    </Button>
  );
}
