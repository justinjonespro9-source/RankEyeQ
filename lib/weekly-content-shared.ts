/** Client-safe WeeklyContent constants — no database access. */
import type {
  ContestPosition,
  WeeklyContentType,
} from "@/lib/generated/prisma/client";

export const WEEKLY_CONTENT_TYPES: WeeklyContentType[] = [
  "VIDEO",
  "ARTICLE",
  "PODCAST",
  "RANKINGS",
  "OTHER",
];
export const WEEKLY_CONTENT_MAX_TITLE = 120;
export const WEEKLY_CONTENT_MAX_PER_WEEK = 10;

export type WeeklyContentItem = {
  id: string;
  title: string;
  url: string;
  type: WeeklyContentType;
  position: ContestPosition | null;
  /** Owner view only: hidden from public display by RankEyeQ moderation. */
  hiddenByModeration?: boolean;
};

export function weeklyContentTypeLabel(type: WeeklyContentType): string {
  switch (type) {
    case "VIDEO":
      return "Video";
    case "ARTICLE":
      return "Article";
    case "PODCAST":
      return "Podcast";
    case "RANKINGS":
      return "Rankings";
    default:
      return "Link";
  }
}
