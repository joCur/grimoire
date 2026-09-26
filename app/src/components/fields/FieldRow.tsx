// The frame every form field stands in: its label, the control, a quiet hint
// and the line that says what blocks a save. Knows nothing about what the
// field belongs to — the caller hands it the translated copy.

import type { ReactNode } from "react";

import { useT } from "@/i18n";

/** Stable per-field DOM id — one form is on screen at a time. */
export function fieldId(key: string): string {
  return `prop-${key.replace(/[^a-zA-Z0-9-]/g, "-")}`;
}

/** The copy a field is shown with — label, and the optional lines around it. */
export interface FieldCopy {
  label: string;
  /** Quiet line under the control. */
  hint?: string;
  /** A field that cannot be emptied: the label says so. */
  required?: boolean;
  /** What blocks the save in THIS field. */
  issue?: string;
  /**
   * The label is for assistive technology only — where a heading right above
   * the field already names it on screen (a field chip's editor).
   */
  labelHidden?: boolean;
}

/** Label, control, hint — the same three lines for every field. */
export function FieldRow({
  label,
  hint,
  required,
  issue,
  labelHidden = false,
  labelFor,
  children,
}: FieldCopy & {
  /** Set when ONE input carries the field; unset for the group controls. */
  labelFor?: string;
  children: ReactNode;
}) {
  const t = useT();
  const text = (
    <span className={labelHidden ? "sr-only" : "text-[12px] text-body-secondary"}>
      {label}
      {required === true && <span className="text-faint">{t("properties.field.required")}</span>}
    </span>
  );
  return (
    <div className="flex flex-col gap-1.5">
      {labelFor === undefined ? (
        text
      ) : (
        <label htmlFor={labelFor} className="flex flex-col">
          {text}
        </label>
      )}
      {children}
      {hint !== undefined && <p className="text-[11.5px] text-faint">{hint}</p>}
      {issue !== undefined && (
        <p aria-live="polite" className="text-[11.5px] text-destructive">
          {issue}
        </p>
      )}
    </div>
  );
}
