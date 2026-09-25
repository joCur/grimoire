// Free key/value rows: a name and a value per row, each row removable, one
// action to add a row. What a row means once it is written — a row without a
// value deletes its key, a row without a name blocks the save — is the pure
// half's (./pairs.ts); this is the rendering.

import { X } from "lucide-react";
import type { KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { INPUT_CLASS } from "@/components/ui/field";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

import { FieldRow, type FieldCopy } from "./FieldRow";
import type { Pair } from "./pairs";

export function PairsField({
  pairs,
  onChange,
  ...copy
}: FieldCopy & {
  pairs: readonly Pair[];
  onChange: (pairs: Pair[]) => void;
}) {
  const t = useT();
  const replace = (index: number, pair: Pair) =>
    onChange(pairs.map((existing, i) => (i === index ? pair : existing)));
  // These two inputs are the only ones in a form where Enter would hit the
  // form's implicit submit — a dialog would save and close in the middle of
  // typing a value. Enter here means "done with this cell", i.e. nothing.
  const swallowEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.preventDefault();
  };

  return (
    <FieldRow {...copy}>
      {pairs.map((pair, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <input
            value={pair.key}
            onChange={(e) => replace(index, { ...pair, key: e.target.value })}
            onKeyDown={swallowEnter}
            aria-label={t("properties.field.row.name.aria", { label: copy.label, row: index + 1 })}
            autoComplete="off"
            spellCheck={false}
            placeholder="insight"
            className={cn(INPUT_CLASS, "flex-1 font-mono text-[13px]")}
          />
          <input
            value={pair.value}
            onChange={(e) => replace(index, { ...pair, value: e.target.value })}
            onKeyDown={swallowEnter}
            aria-label={t("properties.field.row.value.aria", { label: copy.label, row: index + 1 })}
            autoComplete="off"
            spellCheck={false}
            placeholder="+2"
            className={cn(INPUT_CLASS, "w-[84px] flex-none font-mono text-[13px]")}
          />
          <button
            type="button"
            aria-label={t("properties.field.remove.aria", {
              item: pair.key === "" ? t("properties.field.row", { row: index + 1 }) : pair.key,
            })}
            onClick={() => onChange(pairs.filter((_, i) => i !== index))}
            className="flex-none rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X aria-hidden size={13} />
          </button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() => onChange([...pairs, { key: "", value: "" }])}
        className="h-auto self-start border-input bg-transparent px-2.5 py-1 text-[12px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
      >
        {t("properties.field.addRow")}
      </Button>
    </FieldRow>
  );
}
