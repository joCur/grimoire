import { Outlet, Route, Routes } from "react-router";

import { Topbar } from "@/components/Topbar";
import { CampaignsRoute } from "@/routes/campaigns";
import { HarnessRoute } from "@/routes/harness";
import { LiveRoute } from "@/routes/live";
import { PoolRoute } from "@/routes/pool";
import { SceneRoute } from "@/routes/scene";

// App shell per the design reference: constant topbar, the view below is
// the scroll container (keeps the scene aside sticky against it).
function Layout() {
  return (
    <div className="flex h-dvh flex-col">
      <Topbar />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
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
        <Route path=":campaign" element={<PoolRoute />} />
        <Route path=":campaign/live" element={<LiveRoute />} />
        <Route path=":campaign/file/*" element={<SceneRoute />} />
      </Route>
    </Routes>
  );
}
