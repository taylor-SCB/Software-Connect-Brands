"use client";

import { useOptimistic, useTransition } from "react";
import { IconStar } from "@/components/icons";

// The favorite star on a contact or company. Click to fill it yellow,
// click again to clear it; the page updates before the server answers.
export function StarButton({
  id,
  favorite,
  action,
  label,
  size = 15,
}: {
  id: string;
  favorite: boolean;
  action: (id: string, favorite: boolean) => Promise<{ favorite: boolean } | { error: string }>;
  label: string;
  size?: number;
}) {
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(favorite);

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={shown}
      aria-label={shown ? `Remove ${label} from favorites` : `Add ${label} to favorites`}
      title={shown ? "Favorite · click to remove" : "Add to favorites"}
      data-testid="star"
      onClick={() =>
        startTransition(async () => {
          setShown(!shown);
          await action(id, !shown);
        })
      }
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[rgb(255_255_255/0.06)] ${
        shown ? "text-[var(--warn)]" : "text-[var(--text-faint)] hover:text-[var(--text)]"
      }`}
    >
      <IconStar size={size} filled={shown} />
    </button>
  );
}
