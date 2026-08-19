import { Link, Outlet, Route, Routes } from "react-router";

import { CampaignsRoute } from "@/routes/campaigns";
import { HarnessRoute } from "@/routes/harness";
import { PoolRoute } from "@/routes/pool";
import { SceneRoute } from "@/routes/scene";

function Layout() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-8 flex items-baseline justify-between gap-4">
        <Link to="/" className="font-serif text-xl font-semibold">
          Grimoire
        </Link>
        {import.meta.env.DEV && (
          <Link to="/dev/markdown" className="text-xs text-muted-foreground underline">
            Markdown-Harness
          </Link>
        )}
      </header>
      <main>
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
        <Route path="dev/markdown" element={<HarnessRoute />} />
        <Route path=":campaign" element={<PoolRoute />} />
        <Route path=":campaign/file/*" element={<SceneRoute />} />
      </Route>
    </Routes>
  );
}
