// The UI labels of the block types. The six callout names are the format's own
// (markdown/callout-labels.ts — the words the reading view shows); only the
// composer's four structural names are added here. The words live in the
// catalog and the translator is PASSED IN: this module must not decide which
// language the UI is in (decisions/i18n).

import type { SceneBlock } from "@grimoire/shared/blocks";
import type { CalloutKind } from "@grimoire/shared/callouts";

import type { Translate } from "@/i18n";
import { CALLOUT_LABEL_KEYS } from "@/markdown/callout-labels";

/** Label of one callout kind — for a "new block" picker, where there is no block yet. */
export function calloutLabel(kind: CalloutKind, t: Translate): string {
  return t(CALLOUT_LABEL_KEYS[kind]);
}

export function blockLabel(block: SceneBlock, t: Translate): string {
  switch (block.type) {
    case "callout":
      return t(CALLOUT_LABEL_KEYS[block.kind]);
    case "ifSection":
      return t("composer.blockType.ifSection");
    case "heading":
      return t("composer.blockType.heading");
    case "text":
      return t("composer.blockType.text");
    default:
      return t("composer.blockType.markdown");
  }
}
