import { PUBLIC_BRAND_DEFINITION } from "@/lib/brand";
import { NO_WAGERING_DISCLAIMER } from "@/lib/company";
import type { AboutFaqItem } from "@/lib/seo/entity-jsonld";

export const ABOUT_PAGE_TITLE =
  "About RankEyeQ | Weekly Fantasy Football Ranking Competition";

export const ABOUT_PAGE_DESCRIPTION =
  "RankEyeQ is a weekly fantasy-football player-ranking competition where the Public, Experts, Creators, and AI are scored against actual NFL fantasy finishes.";

export const ABOUT_FAQS: AboutFaqItem[] = [
  {
    question: "What is RankEyeQ?",
    answer: `${PUBLIC_BRAND_DEFINITION} Each week you rank NFL QBs, RBs, WRs, TEs, and defenses, then get scored against that week’s actual fantasy-point finishes.`,
  },
  {
    question: "Is RankEyeQ a fantasy-football league?",
    answer:
      "No. RankEyeQ is not a draft league, salary-cap contest, or season-long roster manager. It is a weekly ranking skill game graded against real fantasy finishes.",
  },
  {
    question: "How are RankEyeQ rankings scored?",
    answer:
      "After games finish, boards are graded against actual fantasy-point finishes for that week. The EYEQ Score rewards accurate rankings — especially getting the top of the board right.",
  },
  {
    question: "Can AI models compete?",
    answer:
      "Yes. Public players, Experts, Creators, and AI competitors can all appear on the same scoreboard under the same rules.",
  },
  {
    question: "Is RankEyeQ free to play?",
    answer: `Yes. ${NO_WAGERING_DISCLAIMER}`,
  },
  {
    question:
      "Is RankEyeQ associated with Rank Equity or investment analysis?",
    answer:
      "No. RankEyeQ is unrelated to Rank Equity or any stock-ranking, investment-research, or financial-advice service. It is a fantasy-football skill competition only.",
  },
];
