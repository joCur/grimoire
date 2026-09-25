// A select over a known value set. It offers exactly the options it is
// given — whether clearing the field is a choice is the caller's to say, by
// putting that option into the list.

import { ChevronDown } from "lucide-react";

import { INPUT_CLASS } from "@/components/ui/field";
import { cn } from "@/lib/utils";

import { FieldRow, type FieldCopy } from "./FieldRow";

/** One choice: the value that is written, and what the DM reads. */
export interface FieldOption {
  value: string;
  label: string;
}

export function SelectField({
  id,
  value,
  options,
  onChange,
  ...copy
}: FieldCopy & {
  id: string;
  value: string;
  options: readonly FieldOption[];
  onChange: (value: string) => void;
}) {
  return (
    <FieldRow {...copy} labelFor={id}>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(INPUT_CLASS, "appearance-none pr-9")}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          size={14}
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    </FieldRow>
  );
}
