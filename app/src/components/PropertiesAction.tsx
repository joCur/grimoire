// „Eigenschaften" in the reading view (issue #42, slice 2a of #15): the DM
// edits EVERY properties field of a scene/NPC/Ort/Kapitel in a form — never
// raw YAML, never a text editor detour.
//
// The dialog is the house pattern of issues #30/#34: mounted only while open,
// one aria-live error line, Abbrechen/Speichern. What it adds is the diff —
// only the fields the DM actually changed are sent, so every key the form does
// not know (and every field it did not touch) keeps its stored value.
//
// Two things are deliberately NOT in the form: the `id` (a reference key —
// „Umbenennen" owns it, with its cascade) and the entity kind (derived from the
// path). Both are shown as read-only context so the absence reads as a rule
// rather than as a gap.
//
// The version the save is checked against is frozen when the dialog OPENS: the
// 5s version poll (issue #8) keeps refetching the file behind it, and following
// that rev would turn an external edit into a silent overwrite instead of a
// 409. It moves only after a conflict, to the file the re-read brought — the
// typed values stay, so the next „Speichern" writes on top of what is stored.
//
// Because everything the save uses is frozen, the dialog is bound to ONE path
// (same rule as the body editor of issue #15): the reading route stays mounted
// across a navigation — ⌘K works over the modal, Back reopens a cached file —
// and a dialog holding file A's frozen values while `file` already points at B
// would patch A's diff into B. So the open state IS the file (campaign + path),
// and the content is keyed by it.

import type { CampaignTree, FileResponse } from "@grimoire/shared/types";
import { SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

import { PropertiesFieldControl } from "@/components/PropertiesFields";
import { HeaderAction } from "@/components/HeaderAction";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { fmString } from "@/lib/properties";
import {
  canSubmitProperties,
  commitPendingText,
  propertiesFieldsFor,
  propertiesFormIssues,
  propertiesFormValues,
  propertiesKindLabel,
  propertiesPatch,
  hasPropertiesChanges,
  type FormValues,
  type PropertiesField,
} from "@/lib/properties-form";
import { usePropertiesFormMutation } from "@/lib/use-properties-form";

/**
 * The quiet header trigger, in the same vocabulary as „Bearbeiten" and
 * „Umbenennen" next to it. Renders nothing for the kinds that have no form:
 * the campaign file (its own metadata dialog), sessions and the inbox
 * (app-managed, append-only), glossary and unknown.
 */
export function PropertiesAction({
  campaign,
  file,
  tree,
}: {
  campaign: string;
  file: FileResponse;
  /** For the reference fields — the ids that already have a file. */
  tree: CampaignTree | undefined;
}) {
  // Open-BY-FILE, not a boolean: navigating away closes the dialog instead of
  // leaving it standing over another file's reading view. Campaign AND path,
  // because two campaigns can hold the same relative path (`npcs/jorna`).
  const fileKey = `${campaign}/${file.path}`;
  const [openFile, setOpenFile] = useState<string>();
  const open = openFile === fileKey;
  // …and the state is dropped as well, so returning to the file (Back into the
  // react-query cache) does not reopen a dialog nobody asked for.
  useEffect(() => {
    setOpenFile(undefined);
  }, [fileKey]);
  const fields = propertiesFieldsFor(file.kind);
  const kindLabel = propertiesKindLabel(file.kind);
  if (fields === undefined || kindLabel === undefined) return null;

  return (
    <>
      <HeaderAction
        icon={SlidersHorizontal}
        label="Eigenschaften"
        onClick={() => setOpenFile(fileKey)}
      />
      {open && (
        <PropertiesDialog
          // Belt and braces next to the open-by-file rule: a path change
          // remounts the dialog, so no frozen value can outlive its file.
          key={fileKey}
          campaign={campaign}
          file={file}
          tree={tree}
          fields={fields}
          kindLabel={kindLabel}
          onClose={() => setOpenFile(undefined)}
        />
      )}
    </>
  );
}

function PropertiesDialog({
  campaign,
  file,
  tree,
  fields,
  kindLabel,
  onClose,
}: {
  campaign: string;
  file: FileResponse;
  tree: CampaignTree | undefined;
  fields: readonly PropertiesField[];
  kindLabel: string;
  onClose: () => void;
}) {
  // Both frozen at open, on purpose (see the file header): `initial` is what
  // the diff is measured against — NOT the file behind the dialog, or an
  // external edit landing in the cache would silently swallow the DM's change
  // — and `base` is the version the write is checked against.
  const [initial] = useState<FormValues>(() => propertiesFormValues(fields, file.properties));
  const [values, setValues] = useState<FormValues>(initial);
  const [base, setBase] = useState(file.rev);
  // Text still standing in a chip input, per field key. It lives here so
  // „Speichern" can fold it into its list instead of dropping it.
  const [pending, setPending] = useState<Record<string, string>>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const save = usePropertiesFormMutation(campaign, file.path, base, {
    onSaved: onClose,
    onConflict: (reread) => {
      if (reread !== undefined) setBase(reread.rev);
    },
  });

  // What a save would send: the values plus the pending chip text.
  const effective = commitPendingText(fields, values, pending);
  const patch = propertiesPatch(fields, initial, effective);
  // What is unfinished, per field — an unnamed or a doubled quickstat row.
  // Saving over one of those would lose what the DM typed, so it blocks the
  // save and says why under the field itself.
  // `initial` exempts what the file already holds: free text a migrated
  // campaign carries in `npcs` must not block a save of another field (#70).
  const issues = propertiesFormIssues(fields, effective, initial);
  const canSubmit =
    canSubmitProperties(fields, effective) &&
    Object.keys(issues).length === 0 &&
    Object.keys(patch).length > 0 &&
    !save.isPending;

  const id = fmString(file.properties.id);
  // Esc, the overlay, „Abbrechen" and the X all come through here: with
  // something typed they ask first (house pattern of FileBodyEditor), an
  // untouched form just closes.
  const dirty = hasPropertiesChanges(fields, initial, effective);
  const requestClose = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) requestClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[calc(100dvh-32px)] max-w-[520px] flex-col"
      >
        <DialogTitle>{kindLabel}: Eigenschaften</DialogTitle>
        <DialogDescription>
          Alle Properties-Felder dieses Eintrags. Gespeichert wird nur, was du geändert hast —
          alles andere bleibt unverändert stehen.
        </DialogDescription>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            save.write(patch);
          }}
          className="mt-4 flex min-h-0 flex-1 flex-col"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-0.5">
            {/* The two values the form does not own — shown, not editable. */}
            <p className="text-[12px] text-body-secondary">
              id <span className="font-mono text-[12px] text-soft">{id ?? file.path}</span>
              <span className="text-faint"> · über „Umbenennen" ändern</span>
            </p>
            {fields.map((field) => {
              const value = values[field.key];
              if (value === undefined) return null;
              return (
                <PropertiesFieldControl
                  key={field.key}
                  field={field}
                  value={value}
                  initialValue={initial[field.key]}
                  tree={tree}
                  pending={pending[field.key] ?? ""}
                  issue={issues[field.key]}
                  onChange={(next) =>
                    setValues((previous) => ({ ...previous, [field.key]: next }))
                  }
                  onPendingChange={(text) =>
                    setPending((previous) => ({ ...previous, [field.key]: text }))
                  }
                />
              );
            })}
          </div>

          <p aria-live="polite" className="min-h-[17px] pt-2 text-[12px] text-destructive">
            {save.message ?? ""}
          </p>

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={requestClose}
              className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
            >
              {save.isPending ? "Speichere …" : "Speichern"}
            </Button>
          </div>
        </form>
      </DialogContent>
      {confirmDiscard && (
        <Dialog
          open
          onOpenChange={(isOpen) => {
            if (!isOpen) setConfirmDiscard(false);
          }}
        >
          <DialogContent aria-describedby={undefined} className="max-w-[420px]">
            <DialogTitle>Änderungen verwerfen?</DialogTitle>
            <DialogDescription>
              Die geänderten Eigenschaften sind nicht gespeichert. Verwerfen schließt das Fenster
              und lässt den Eintrag so, wie er gespeichert ist.
            </DialogDescription>
            <div className="mt-4 flex items-center justify-end gap-2">
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
                >
                  Weiter bearbeiten
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setConfirmDiscard(false);
                  onClose();
                }}
                className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
              >
                Verwerfen
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}
