// One row of a list page: icon, title, a quiet meta line, and the whole row a
// link. Width-agnostic, the same on a phone and on the desktop.

import { ChevronRight, type LucideIcon } from "lucide-react";
import { Link } from "react-router";

export function ListRow({
  to,
  icon: Icon,
  title,
  meta,
}: {
  to: string;
  icon: LucideIcon;
  title: string;
  meta: string | undefined;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-[52px] items-center gap-3 rounded-md border-b border-divider px-1 py-1.5 hover:bg-card"
    >
      <Icon aria-hidden size={16} className="flex-none text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] text-foreground">{title}</span>
        {meta !== undefined && meta !== "" && (
          <span className="mt-px block truncate text-[12.5px] text-muted-foreground">{meta}</span>
        )}
      </span>
      <ChevronRight aria-hidden size={15} className="flex-none text-faint" />
    </Link>
  );
}
