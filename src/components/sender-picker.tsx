"use client";

import { useMemo, useState } from "react";
import { IconSearch } from "@/components/icons";

export type PickableUser = { id: string; name: string; email: string };

// "Who can send?" on a contract template. Everyone in the workspace by
// default; switch that off and tick the people who may send contracts
// made from this template. The ticked list is kept while the switch is
// on, so toggling back and forth loses nothing.
export function SenderPicker({
  users,
  currentUserId,
  defaultAllUsers = true,
  defaultSenderIds = [],
}: {
  users: PickableUser[];
  currentUserId: string;
  defaultAllUsers?: boolean;
  defaultSenderIds?: string[];
}) {
  const [allUsers, setAllUsers] = useState(defaultAllUsers);
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultSenderIds));
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      q
        ? users.filter(
            (user) => user.name.toLowerCase().includes(q) || user.email.toLowerCase().includes(q),
          )
        : users,
    [users, q],
  );
  const picked = users.filter((user) => selected.has(user.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)]">
      <input type="hidden" name="allUsersCanSend" value={allUsers ? "true" : "false"} />
      {picked.map((user) => (
        <input key={user.id} type="hidden" name="senderUserIds" value={user.id} />
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
        <div>
          <p className="text-sm font-medium">Who can send?</p>
          <p className="faint text-xs">
            {allUsers
              ? "All company users can send contracts made from this template."
              : picked.length
                ? `Only ${picked.map((user) => user.name).join(", ")} can send.`
                : "Tick at least one person below."}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
          All company users
          <button
            type="button"
            role="switch"
            aria-checked={allUsers}
            aria-label="All company users can send"
            onClick={() => setAllUsers((value) => !value)}
            className="switch"
          />
        </label>
      </div>

      {!allUsers && (
        <div className="border-t border-[var(--border)]">
          <div className="p-2.5">
            <div className="relative">
              <IconSearch
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search people…"
                aria-label="Search people"
                className="input input-sm pl-8"
              />
            </div>
          </div>
          <ul className="max-h-52 overflow-y-auto pb-1">
            {visible.length === 0 && (
              <li className="faint px-4 py-4 text-center text-xs">Nobody matches.</li>
            )}
            {visible.map((user) => (
              <li key={user.id}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-1.5 text-sm hover:bg-[rgb(255_255_255/0.04)]">
                  <input
                    type="checkbox"
                    checked={selected.has(user.id)}
                    onChange={() => toggle(user.id)}
                    className="h-4 w-4 accent-[var(--brand)]"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {user.name}
                    <span className="faint"> · {user.email}</span>
                  </span>
                  {user.id === currentUserId && <span className="faint text-[0.66rem]">you</span>}
                </label>
              </li>
            ))}
          </ul>
          {users.length === 1 && (
            <p className="faint border-t border-[var(--border)] px-4 py-2 text-[0.7rem]">
              You are the only user in this workspace today. Teammates show up here once they
              have logins.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
