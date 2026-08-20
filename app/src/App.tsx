import { Outlet, Route, Routes, useParams } from "react-router";

import { Topbar } from "@/components/Topbar";
import { ReviewMemoryProvider } from "@/lib/review-memory";
import { useCampaignVersion } from "@/lib/use-campaign-version";
import { BrowseRoute } from "@/routes/browse";
import { CampaignsRoute } from "@/routes/campaigns";
import { HarnessRoute } from "@/routes/harness";
import { LiveRoute } from "@/routes/live";
import { PoolRoute } from "@/routes/pool";
import { ReviewRoute } from "@/routes/review";
import { SceneRoute } from "@/routes/scene";

// Shared layout of all campaign-scoped views: mounts the version polling
// exactly once per campaign (issue #8 client side) — when the server's file
// watcher bumps the counter, the campaign's queries refetch quietly.
function CampaignScope() {
  const { campaign = "" } = useParams();
  useCampaignVersion(campaign);
  return <Outlet />;
}

// App shell per the design reference: constant topbar, the view below is
// the scroll container (keeps the scene aside sticky against it).
// The review memory (issue #10) wraps both so the topbar's progress counts
// exactly the cards the review page shows.
function Layout() {
  return (
    <ReviewMemoryProvider>
      <div className="flex h-dvh flex-col">
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
        <Route index element={<CampaignsRoute />} />
        {/* Dev-only markdown harness (CLAUDE.md renderer check) — reached by
            URL, deliberately not linked from the chrome. */}
        {import.meta.env.DEV && <Route path="dev/markdown" element={<HarnessRoute />} />}
        <Route path=":campaign" element={<CampaignScope />}>
          <Route index element={<PoolRoute />} />
          {/* Mobile list pages (issue #11) — linked only from the start surface. */}
          <Route path="list/:kind" element={<BrowseRoute />} />
          <Route path="live" element={<LiveRoute />} />
          {/* Review ("Fünf Minuten Ernte", issue #10) — entered after
              "Session beenden" and from the pool affordance. */}
          <Route path="review" element={<ReviewRoute />} />
          <Route path="file/*" element={<SceneRoute />} />
        </Route>
      </Route>
    </Routes>
  );
}
