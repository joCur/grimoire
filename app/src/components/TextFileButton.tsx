// A button that reads a text file from disk into the browser: the DM picks
// the file, and its whole text goes to `onLoad`. Nothing is uploaded or
// kept — the caller decides what the text becomes.
//
// The file input itself stays out of sight and out of the tab order; the
// button is the control the DM uses.

import { FileUp } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";

export function TextFileButton({
  label,
  accessibleLabel,
  accept = ".md,.markdown,.txt,text/plain,text/markdown",
  onLoad,
  onError,
  testId,
  disabled,
}: {
  /** The button's visible text. */
  label: string;
  /** What the button does in full, for assistive technology — it names the field. */
  accessibleLabel?: string;
  /** The file types the picker offers. */
  accept?: string;
  /** Receives the file's whole text. */
  onLoad: (text: string) => void;
  /** Called when the browser cannot read the file. */
  onError?: () => void;
  testId?: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-label={accessibleLabel}
        onClick={() => input.current?.click()}
        className="h-7 px-2 text-[12px] text-muted-foreground"
      >
        <FileUp aria-hidden />
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid={testId}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared, so picking the same file again loads it again.
          event.target.value = "";
          if (file === undefined) return;
          file.text().then(onLoad, () => onError?.());
        }}
      />
    </>
  );
}
