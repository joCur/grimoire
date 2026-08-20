// "‹ Pool" back row of the mobile read/list views (design/Grimoire-Mobil):
// links to /:campaign, which below md IS the mobile start surface (same
// route, responsive swap). Hidden at md+ — the desktop has the topbar.

import { ChevronLeft } from "lucide-react";
import { Link } from "react-router";

export function MobileBackRow({ campaign }: { campaign: string }) {
  return (
    <div className="border-b border-border px-3 py-0.5 md:hidden">
      <Link
        to={`/${campaign}`}
        className="inline-flex min-h-11 items-center gap-0.5 rounded-md pr-2.5 pl-1 text-[15px] text-primary hover:text-primary-hover"
      >
        <ChevronLeft aria-hidden size={18} className="flex-none" />
        Pool
      </Link>
    </div>
  );
}
