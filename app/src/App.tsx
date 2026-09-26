import { Outlet, Route, Routes, useParams } from "react-router";

import { ChapterRoute } from "@/chapter/ChapterRoute";
import { NotFound } from "@/components/NotFound";
import { Topbar } from "@/components/Topbar";
import { UpdateBanner } from "@/components/UpdateBanner";
import { ReviewMemoryProvider } from "@/lib/review-memory";
import { useCampaignVersion } from "@/lib/use-campaign-version";
import { RefProvider } from "@/markdown/refs";
import { BrowseRoute } from "@/routes/browse";
import { GenerateRoute } from "@/routes/generate";
import { GlossaryRoute } from "@/glossary-term/GlossaryRoute";
import { HarnessRoute } from "@/routes/harness";
import { HomeRoute } from "@/routes/home";
import { KnowledgeRoute } from "@/knowledge-item/KnowledgeRoute";
import { LiveRoute } from "@/routes/live";
import { LocationCreateAction } from "@/location/LocationCreateAction";
import { LocationList } from "@/location/LocationList";
import { LocationRoute } from "@/location/LocationRoute";
import { LocationAugmentAction } from "@/routes/LocationAugmentAction";
import { NpcCard } from "@/npc/NpcCard";
import { NpcCreateAction } from "@/npc/NpcCreateAction";
import { NpcList } from "@/npc/NpcList";
import { NpcRoute } from "@/npc/NpcRoute";
import { NpcAugmentAction } from "@/routes/NpcAugmentAction";
import { ChapterOverviewRoute } from "@/routes/chapter-overview";
import { ReviewRoute } from "@/routes/review";
import { SettingsRoute } from "@/routes/settings";
import { SceneAugmentAction } from "@/routes/SceneAugmentAction";
import { SceneList } from "@/scene/SceneList";
import { SceneRoute } from "@/scene/SceneRoute";
import { sceneHref } from "@/scene/scene-links";
import { SessionRoute } from "@/session/SessionRoute";

// Shared layout of all campaign-scoped views: mounts the version polling
// exactly once per campaign — when the server bumps the counter (which it
// does in the same transaction as every write), the campaign's queries
// refetch quietly.
function CampaignScope() {
  const { campaign = "" } = useParams();
  useCampaignVersion(campaign);
  // `[[slug]]` references resolve against the campaign tree —
  // mounted here so EVERY view's markdown bodies resolve the same way, off
  // the tree query the views already share.
  return (
    <RefProvider campaign={campaign}>
      <Outlet />
    </RefProvider>
  );
}

// A path under a campaign that no route knows: the way back is the campaign.
function CampaignNotFound() {
  const { campaign = "" } = useParams();
  return <NotFound campaign={campaign} />;
}

// App shell per the design reference: constant topbar, the view below is
// the scroll container (keeps the scene aside sticky against it).
// The review memory wraps both so the topbar's progress counts
// exactly the cards the review page shows.
// The update banner sits above the topbar and therefore above
// every view including the mobile surfaces, where the topbar is hidden; it
// renders nothing unless the version poll saw a build mismatch.
function Layout() {
  return (
    <ReviewMemoryProvider>
      <div className="flex h-dvh flex-col">
        <UpdateBanner />
        <Topbar />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </ReviewMemoryProvider>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* "/" is a redirect into the last active campaign — there is no
            campaign list page. */}
        <Route index element={<HomeRoute />} />
        {/* Dev-only markdown harness (CLAUDE.md renderer check) — reached by
            URL, deliberately not linked from the chrome. */}
        {import.meta.env.DEV && <Route path="dev/markdown" element={<HarnessRoute />} />}
        {/* Instance settings — deliberately NOT campaign-scoped: the gear has
            to work on a fresh instance too, and the language is an instance
            choice. Campaign CONTENT is not a setting and lives on its own
            pages below. */}
        <Route path="settings" element={<SettingsRoute />} />
        {/* Everything campaign-scoped hangs under the campaign, so no
            campaign id is ever a first path segment and no route above can
            collide with one (decisions/resources). */}
        <Route path="campaigns/:campaign" element={<CampaignScope />}>
          <Route index element={<ChapterOverviewRoute />} />
          {/* The campaign is its own resource, and its route is the chapter
              overview above. A chapter, a scene, an npc and a location are
              each their own resource as well (decisions/resources): their reading views
              live at their own routes, and so do the npc and location lists,
              reached from the topbar's quiet npc and location links and the
              mobile lookup rows. The scene's reading view is handed the npc
              cards of its aside — the npc draws them, the scene only says
              where — and each reading view its augment action, the generator
              job's dialog joined with the entity's own write. */}
          <Route path="chapters/:id" element={<ChapterRoute />} />
          {/* The scene list — reached from the mobile start surface's
              lookup rows. Each list page draws the rows of its own slice. */}
          <Route
            path="scenes"
            element={
              <BrowseRoute
                titleKey="browse.title.scenes"
                list={(campaign, tree) => <SceneList campaign={campaign} tree={tree} />}
              />
            }
          />
          <Route
            path="scenes/:id"
            element={
              <SceneRoute
                npcCard={(campaign, id) => <NpcCard campaign={campaign} id={id} />}
                augmentAction={(campaign, scene) => (
                  <SceneAugmentAction campaign={campaign} scene={scene} />
                )}
              />
            }
          />
          <Route
            path="npcs"
            element={
              <BrowseRoute
                titleKey="browse.title.npcs"
                action={(campaign) => <NpcCreateAction campaign={campaign} />}
                list={(campaign) => <NpcList campaign={campaign} />}
              />
            }
          />
          <Route
            path="npcs/:id"
            element={
              <NpcRoute
                augmentAction={(campaign, npc) => <NpcAugmentAction campaign={campaign} npc={npc} />}
              />
            }
          />
          <Route
            path="locations"
            element={
              <BrowseRoute
                titleKey="browse.title.locations"
                action={(campaign) => <LocationCreateAction campaign={campaign} />}
                list={(campaign, tree) => <LocationList campaign={campaign} tree={tree} />}
              />
            }
          />
          <Route
            path="locations/:id"
            element={
              <LocationRoute
                augmentAction={(campaign, location) => (
                  <LocationAugmentAction campaign={campaign} location={location} />
                )}
              />
            }
          />
          {/* Campaign knowledge and glossary — campaign CONTENT, so they are
              list pages next to the npc/location ones and not sections of
              /settings. Reached from the chapter overview's lookup line, the
              mobile start surface, ⌘K and the generator's context line —
              deliberately not from the topbar. */}
          <Route path="knowledge" element={<KnowledgeRoute />} />
          <Route path="glossary" element={<GlossaryRoute />} />
          <Route path="live" element={<LiveRoute />} />
          {/* Generator — entered from the chapter overview's "Generator". */}
          <Route path="generate" element={<GenerateRoute />} />
          {/* Review — the session review, entered after ending a session
              and from the chapter overview affordance. */}
          <Route path="review" element={<ReviewRoute />} />
          {/* One evening, read-only. Reached from ⌘K. The scenes of its
              notes link to the scene's own route, handed in from here. */}
          <Route path="sessions/:id" element={<SessionRoute sceneHref={sceneHref} />} />
          <Route path="*" element={<CampaignNotFound />} />
        </Route>
        {/* Any other path: the not-found view, inside the layout so the
            topbar stays. */}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
