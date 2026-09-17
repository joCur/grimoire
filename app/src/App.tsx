import { Outlet, Route, Routes, useParams } from "react-router";

import { Topbar } from "@/components/Topbar";
import { UpdateBanner } from "@/components/UpdateBanner";
import { ReviewMemoryProvider } from "@/lib/review-memory";
import { useCampaignVersion } from "@/lib/use-campaign-version";
import { EntityRefProvider } from "@/markdown/entity-refs";
import { BrowseRoute } from "@/routes/browse";
import { GenerateRoute } from "@/routes/generate";
import { GlossaryRoute } from "@/routes/glossary";
import { HarnessRoute } from "@/routes/harness";
import { HomeRoute } from "@/routes/home";
import { KnowledgeRoute } from "@/routes/knowledge";
import { LiveRoute } from "@/routes/live";
import { PoolRoute } from "@/routes/pool";
import { ReviewRoute } from "@/routes/review";
import { SceneRoute } from "@/routes/scene";
import { SettingsRoute } from "@/routes/settings";

// Shared layout of all campaign-scoped views: mounts the version polling
// exactly once per campaign (issue #8 client side) — when the server bumps
// the counter (which it does in the same transaction as every write since
// issue #57), the campaign's queries refetch quietly.
function CampaignScope() {
  const { campaign = "" } = useParams();
  useCampaignVersion(campaign);
  // `[[slug]]` references resolve against the campaign tree —
  // mounted here so EVERY view's markdown bodies resolve the same way, off
  // the tree query the views already share.
  return (
    <EntityRefProvider campaign={campaign}>
      <Outlet />
    </EntityRefProvider>
  );
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
        {/* "/" is a redirect into the last active campaign (issue #14) —
            there is no campaign list page. */}
        <Route index element={<HomeRoute />} />
        {/* Dev-only markdown harness (CLAUDE.md renderer check) — reached by
            URL, deliberately not linked from the chrome. */}
        {import.meta.env.DEV && <Route path="dev/markdown" element={<HarnessRoute />} />}
        {/* Instance settings (issue #69) — deliberately NOT campaign-scoped:
            the gear has to work on a fresh instance too, and the language is
            an instance choice. Campaign CONTENT is not a setting and lives on
            its own pages below (PO feedback on PR #87). */}
        <Route path="settings" element={<SettingsRoute />} />
        {/* Everything campaign-scoped hangs under the campaign, so no
            campaign id is ever a first path segment and no route above can
            collide with one (ADR #22). */}
        <Route path="campaigns/:campaign" element={<CampaignScope />}>
          <Route index element={<PoolRoute />} />
          {/* The browse list pages (issue #11) — reached from the mobile start
              surface's "Nachschlagen" rows and from the topbar's quiet
              NPCs/Orte links on the desktop (issue #34). */}
          <Route path="list/:kind" element={<BrowseRoute />} />
          {/* Campaign knowledge and glossary (issue #53) — campaign CONTENT,
              so they are list pages next to the npc/location ones and not
              sections of /settings (PO feedback on PR #87). Reached from the
              pool's „Nachschlagen" line, the mobile start surface, ⌘K and the
              generator's context line — deliberately not from the topbar. */}
          <Route path="knowledge" element={<KnowledgeRoute />} />
          <Route path="glossary" element={<GlossaryRoute />} />
          <Route path="live" element={<LiveRoute />} />
          {/* Generator (issue #12) — entered from the pool's "Generator". */}
          <Route path="generate" element={<GenerateRoute />} />
          {/* Review — the "Session-Nachbereitung" (issue #10, formerly
              "Fünf Minuten Ernte") — entered after
              "Session beenden" and from the pool affordance. */}
          <Route path="review" element={<ReviewRoute />} />
          <Route path="entries/*" element={<SceneRoute />} />
        </Route>
      </Route>
    </Routes>
  );
}
