// A choice of ONE value from a known list, as a list of radio rows — the
// editor of a field chip whose values are fixed (a type) or already exist (a
// chapter, a location). With `search` a filter input stands above the rows:
// typing narrows them, Enter picks the first row that is left.
//
// Every row is a native button with role="radio", so the list is reachable
// by Tab and readable as one radio group; the checked row carries the check
// mark. Knows nothing about what the values belong to — the caller hands it
// the translated labels.

import { Check } from "lucide-react";
import { useState } from "react";

import { INPUT_CLASS } from "@/components/ui/field";
import { cn } from "@/lib/utils";

import type { FieldOption } from "./SelectField";

/** One row: the value that is written, what the DM reads, and a quiet line beside it. */
export interface PickOption extends FieldOption {
  hint?: string;
}

export function PickList({
  label,
  options,
  value,
  onChange,
  search,
}: {
  /** The radio group's accessible name. */
  label: string;
  options: readonly PickOption[];
  value: string;
  onChange: (value: string) => void;
  /** A filter above the rows, for lists that can grow long. */
  search?: { placeholder: string; noMatch: string };
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const shown =
    needle === ""
      ? options
      : options.filter(
          (option) =>
            option.label.toLocaleLowerCase().includes(needle) ||
            option.value.toLocaleLowerCase().includes(needle),
        );
  return (
    <div className="flex flex-col gap-2.5">
      {search !== undefined && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            const first = shown[0];
            if (first !== undefined) onChange(first.value);
          }}
          placeholder={search.placeholder}
          aria-label={search.placeholder}
          autoComplete="off"
          className={cn(INPUT_CLASS, "py-1.5")}
        />
      )}
      <div role="radiogroup" aria-label={label} className="flex max-h-[240px] flex-col gap-0.5 overflow-y-auto">
        {shown.map((option) => {
          const checked = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange(option.value)}
              className={cn(
                "flex min-h-[34px] items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-body max-md:min-h-[44px]",
                checked ? "bg-primary/15 text-foreground" : "hover:bg-primary/10",
              )}
            >
              <span className="min-w-0 flex-1">
                {option.label}
                {option.hint !== undefined && (
                  <span className="ml-1.5 text-[12px] text-dim">{option.hint}</span>
                )}
              </span>
              <span aria-hidden className="flex w-3.5 flex-none justify-center text-primary">
                {checked && <Check size={13} />}
              </span>
            </button>
          );
        })}
        {shown.length === 0 && search !== undefined && (
          <p className="px-2.5 py-1.5 text-[12.5px] text-dim">{search.noMatch}</p>
        )}
      </div>
    </div>
  );
}
