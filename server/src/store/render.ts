// The row shapes of the campaign, the chapter, the scene, the npc and the
// location.
//
// A domain module and its neighbours read one definition of these rows here.
// Each entity renders itself in its own domain module (decisions/resources:
// ./campaigns.ts, ./chapters.ts, ./scenes.ts, ./npcs.ts, ./locations.ts).

// --- row shapes (the columns the renderer needs) ----------------------------

export interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  body: string;
  version: number;
  rev: number;
  /** Markdown above the glossary terms — a field of the campaign. */
  glossaryIntro: string;
  /** Guard token of the knowledge-item ORDER, separate from `rev`. */
  knowledgeItemOrderRev: number;
}

export interface ChapterRow {
  campaignId: string;
  id: string;
  title: string;
  status: string | null;
  body: string;
  pos: number;
  rev: number;
  /** Guard token of the chapter's scene ORDER, separate from `rev`. */
  sceneOrderRev: number;
}

export interface SceneRow {
  campaignId: string;
  id: string;
  /** The owning chapter — never absent (schema.ts). */
  chapterId: string;
  title: string;
  type: string;
  trigger: string | null;
  location: string | null;
  status: string;
  handouts: string;
  body: string;
  pos: number;
  rev: number;
}

export interface NpcRow {
  campaignId: string;
  id: string;
  name: string;
  role: string | null;
  chapterId: string | null;
  status: string;
  statblock: string | null;
  quickstats: string;
  voice: string | null;
  appearance: string | null;
  motivation: string | null;
  body: string;
  rev: number;
}

export interface LocationRow {
  campaignId: string;
  id: string;
  name: string;
  chapterId: string | null;
  roll20Page: string | null;
  atmosphere: string | null;
  body: string;
  rev: number;
}
