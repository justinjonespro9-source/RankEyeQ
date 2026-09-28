"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import {
  createWeeklyContentAction,
  deleteWeeklyContentAction,
  updateWeeklyContentAction,
} from "@/lib/official-board-actions";
import {
  WEEKLY_CONTENT_MAX_TITLE,
  WEEKLY_CONTENT_TYPES,
  weeklyContentTypeLabel,
  type WeeklyContentItem,
} from "@/lib/weekly-content-shared";

type Draft = { title: string; url: string; type: string; scope: "position" | "week" };

const emptyDraft: Draft = { title: "", url: "", type: "VIDEO", scope: "position" };

/** Owner-only weekly links (video, article, …). Never affects the board. */
export function WeeklyContentManager({
  weekId,
  position,
  items,
}: {
  weekId: string;
  position: string;
  items: WeeklyContentItem[];
}) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function save() {
    setMessage(null);
    const content = {
      title: draft.title,
      url: draft.url,
      type: draft.type,
      position: draft.scope === "position" ? position : null,
    };
    startTransition(async () => {
      const result = editingId
        ? await updateWeeklyContentAction({
            id: editingId,
            content,
            pagePosition: position,
          })
        : await createWeeklyContentAction({
            weekId,
            content,
            pagePosition: position,
          });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setDraft(emptyDraft);
      setEditingId(null);
      setMessage(editingId ? "Link updated." : "Link added.");
    });
  }

  function remove(id: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await deleteWeeklyContentAction({ id, pagePosition: position });
      setMessage(result.ok ? "Link removed." : result.error);
    });
  }

  return (
    <section
      aria-label="Weekly content"
      className="mb-6 rounded-md border border-border bg-surface px-4 py-3"
    >
      <p className="text-sm font-semibold text-ink">Weekly content</p>
      <p className="mt-1 text-sm text-muted">
        Link your breakdown for this week. Links show on your public board
        page — even while the board is protected — and never change your
        rankings.
      </p>

      {items.length > 0 ? (
        <ul className="mt-3 divide-y divide-border rounded-md border border-border bg-surface-elevated">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate text-ink">
                <span className="mr-2 text-xs uppercase tracking-wide text-muted">
                  {weeklyContentTypeLabel(item.type)}
                  {item.position ? ` · ${item.position}` : " · All positions"}
                </span>
                {item.title}
                {item.hiddenByModeration ? (
                  <span className="ml-2 text-xs text-warning">
                    Hidden from your public page by RankEyeQ moderation
                  </span>
                ) : null}
              </span>
              <span className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setEditingId(item.id);
                    setDraft({
                      title: item.title,
                      url: item.url,
                      type: item.type,
                      scope: item.position ? "position" : "week",
                    });
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => remove(item.id)}
                >
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <input
          aria-label="Title"
          className="rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm"
          placeholder="Watch my Week breakdown"
          maxLength={WEEKLY_CONTENT_MAX_TITLE}
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
        <input
          aria-label="Link"
          type="url"
          className="rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm"
          placeholder="https://"
          value={draft.url}
          onChange={(event) => setDraft({ ...draft, url: event.target.value })}
        />
        <select
          aria-label="Type"
          className="rounded-md border border-border bg-surface-elevated px-2 py-2 text-sm"
          value={draft.type}
          onChange={(event) => setDraft({ ...draft, type: event.target.value })}
        >
          {WEEKLY_CONTENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {weeklyContentTypeLabel(type)}
            </option>
          ))}
        </select>
        <select
          aria-label="Applies to"
          className="rounded-md border border-border bg-surface-elevated px-2 py-2 text-sm"
          value={draft.scope}
          onChange={(event) =>
            setDraft({ ...draft, scope: event.target.value as Draft["scope"] })
          }
        >
          <option value="position">{position} only</option>
          <option value="week">All positions</option>
        </select>
        <Button size="sm" type="submit" disabled={pending}>
          {editingId ? "Save link" : "Add link"}
        </Button>
      </form>
      {message ? (
        <p className="mt-2 text-sm text-ink" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
