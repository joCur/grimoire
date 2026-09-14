import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import { App } from "@/App";
import { I18nProvider } from "@/i18n";

import "@fontsource-variable/literata";
import "@fontsource-variable/literata/wght-italic.css";
import "./index.css";

// No localStorage persistence anywhere — the server is the source of truth
// (quality floor, CLAUDE.md).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

// A DATA router with ONE catch-all route, so `<App />`'s `<Routes>` keeps
// owning the route table (review of #53). The switch away from
// `<BrowserRouter>` buys exactly one thing: react-router's navigation
// BLOCKER only exists on a data router, and the campaign-content pages need
// it to ask
// before throwing an unsaved entry away (components/UnsavedChangesGuard.tsx).
// No loaders, no actions — the queries stay with TanStack Query — so this is
// the smallest form that provides the router context.
const router = createBrowserRouter([{ path: "*", element: <App /> }]);

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root element missing in index.html");

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* The UI language (issue #69) comes from the server, so the provider
          sits INSIDE the query client and above everything that renders
          copy — a switch re-renders the whole tree at once. */}
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
