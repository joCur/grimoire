// The one look of a text control in this app: the input/select/textarea style
// the „Umbenennen"/„Kampagne"/„Eigenschaften" dialogs (issues #30/#34/#42)
// established and the Block-Composer's per-block forms (#43) reuse.
//
// It lives here because neither of the two component modules owns it — a second
// copy is how two surfaces that are supposed to feel identical start drifting
// by a pixel. `max-md:text-[16px]` is not cosmetic: below 16px iOS Safari zooms
// the page on focus, which on a phone is the difference between „typed a note"
// and „lost the page".

export const INPUT_CLASS =
  "w-full rounded-md border border-input bg-panel-deep px-3 py-2 text-[13.5px] text-foreground placeholder:text-muted-foreground max-md:text-[16px]";
