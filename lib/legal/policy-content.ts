import { PUBLIC_BRAND_NAME } from "@/lib/brand";
import {
  COMPANY_LEGAL_NAME,
  COMPANY_NAME,
  NO_WAGERING_DISCLAIMER,
  formatContactLine,
  THIRD_PARTY_MARKS_NOTICE,
} from "@/lib/company";
import {
  ELIGIBILITY_AGE_STANDARD,
  ELIGIBILITY_JURISDICTION_NOTICE,
  ELIGIBILITY_SUMMARY,
} from "@/lib/legal/eligibility";
import type { PolicyDefinition } from "@/lib/legal/policies";

const PRODUCT = PUBLIC_BRAND_NAME;

function contactSection() {
  return {
    heading: "Contact",
    body: formatContactLine(),
  };
}

export const POLICY_LAST_UPDATED = "2026-09-01";

export const POLICY_DEFINITIONS_CONTENT: Omit<
  PolicyDefinition,
  "slug"
>[] = [
  {
    title: "Terms of Use",
    description: "Rules for using RankEyeQ, accounts, contests, and community features.",
    requiresReview: true,
    requiresAcceptance: true,
    effectiveDate: POLICY_LAST_UPDATED,
    lastUpdated: POLICY_LAST_UPDATED,
    sections: [
      {
        heading: "Acceptance of terms",
        body:
          `By accessing or using ${PRODUCT}, you agree to these Terms of Use and our Privacy Policy. ` +
          "If you do not agree, do not use the service.",
      },
      {
        heading: "Who operates the service",
        body:
          `${PRODUCT} is operated by ${COMPANY_LEGAL_NAME} ("${COMPANY_NAME}," "we," "us," or "our"). ` +
          `${PRODUCT} is a product of ${COMPANY_NAME}.`,
      },
      {
        heading: "Service description",
        body:
          `${PRODUCT} is a free-to-play fantasy sports ranking and skill-comparison platform for NFL weekly player contests. ` +
          "Users submit ordered rankings for eligible players at each position. Submissions are graded against actual weekly fantasy production using the published scoring methodology.",
      },
      {
        heading: "Free-to-play; no wagering",
        body: NO_WAGERING_DISCLAIMER,
      },
      {
        heading: "Account eligibility",
        body: `${ELIGIBILITY_SUMMARY} ${ELIGIBILITY_JURISDICTION_NOTICE}`,
      },
      {
        heading: "User accounts and security",
        body:
          "You are responsible for maintaining the confidentiality of your sign-in credentials and for activity under your account. " +
          "Provide accurate account information. One human account per person unless we expressly authorize otherwise.",
      },
      {
        heading: "Contest and ranking participation",
        body:
          "Weekly contests open and lock according to published timing rules. Only complete, submitted boards within an open contest count. " +
          "Draft saves do not count as submissions. Slot depths, lock behavior, reveal windows, and scoring are described in How to Play and contest rules.",
      },
      {
        heading: "User-generated content",
        body:
          "You may provide profile information, bios, and ranking submissions. You represent that your content is lawful and does not infringe others' rights. " +
          "You grant us a license to host, display, and process your content to operate the service, including public leaderboard and profile display where rules allow.",
      },
      {
        heading: "Community conduct",
        body:
          "Do not harass, impersonate, spam, manipulate rankings, scrape private boards outside permitted windows, or upload illegal content. " +
          "See our Community Guidelines for additional detail.",
      },
      {
        heading: "AI competitors and automated participants",
        body:
          `${PRODUCT} includes AI Competitor profiles that are clearly labeled and are not human participants. ` +
          "AI rankings may be prepared through administrative workflows and are graded using the same methodology as comparable human rankers. See our AI Disclosure.",
      },
      {
        heading: "Intellectual property",
        body:
          `${PRODUCT}, its branding, software, scoring systems, and original content are owned by ${COMPANY_LEGAL_NAME} or its licensors. ` +
          "You may not copy, reverse engineer, or commercially exploit the service except as permitted by law or with our written consent.",
      },
      {
        heading: "Third-party data and services",
        body:
          "Roster, schedule, and results data may come from third-party sources and NFL-licensed materials. " +
          THIRD_PARTY_MARKS_NOTICE,
      },
      {
        heading: "Suspension and termination",
        body:
          "We may suspend or terminate access for violations of these Terms, suspected abuse, legal requirements, or operational needs. " +
          "You may stop using the service at any time.",
      },
      {
        heading: "Disclaimers",
        body:
          `${PRODUCT} is provided "as is" and "as available." Rankings, scores, AI outputs, and leaderboards are for entertainment and skill comparison. ` +
          "They are not betting advice, financial advice, or professional sports analysis.",
      },
      {
        heading: "Limitation of liability",
        body:
          "To the fullest extent permitted by applicable law, " +
          `${COMPANY_LEGAL_NAME} is not liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits or data, arising from your use of ${PRODUCT}.`,
      },
      {
        heading: "Changes to the service and terms",
        body:
          "We may modify features, contests, or these Terms. Material changes will be posted with an updated effective date. Continued use after changes become effective constitutes acceptance where permitted by law.",
      },
      {
        heading: "Governing law",
        body:
          "Governing law and venue provisions will be specified following legal review. Until then, disputes should be directed to us using the contact method below.",
      },
      contactSection(),
    ],
  },
  {
    title: "Privacy Policy",
    description: "How RankEyeQ collects, uses, and protects information.",
    requiresReview: true,
    requiresAcceptance: true,
    effectiveDate: POLICY_LAST_UPDATED,
    lastUpdated: POLICY_LAST_UPDATED,
    sections: [
      {
        heading: "Who operates RankEyeQ",
        body:
          `${COMPANY_LEGAL_NAME} operates ${PRODUCT}. This Privacy Policy describes how we handle information when you use ${PRODUCT}.`,
      },
      {
        heading: "Information you provide",
        body:
          "We collect information you submit, including email address for authentication, profile fields (such as username, display name, and optional avatar URL), and ranking submissions.",
      },
      {
        heading: "Account and profile information",
        body:
          "Account records are linked to a UniversalProfile used across RankEyeQ features. Profile pages may display public rankings, stats, and bio content you choose to publish.",
      },
      {
        heading: "Ranking and submission activity",
        body:
          "We store your contest submissions, draft saves, scores, leaderboard placements, and related contest metadata needed to grade contests and display results.",
      },
      {
        heading: "Usage and device data",
        body:
          "We log operational events (such as sign-in, submissions, and feature usage) through server-side logging. " +
          "We do not currently operate third-party advertising trackers or sell personal information.",
      },
      {
        heading: "Cookies and session storage",
        body:
          "Authentication uses session cookies managed by our auth provider (Auth.js / NextAuth with database sessions). " +
          "See our Cookie Notice for details.",
      },
      {
        heading: "How we use information",
        body:
          "To authenticate you, operate contests, calculate scores, display leaderboards and profiles, prevent abuse, improve reliability, and communicate about the service.",
      },
      {
        heading: "Service providers",
        body:
          "We use infrastructure and email providers to host the application and deliver sign-in messages when configured (for example, Resend or SMTP). " +
          "Providers process data only to perform services on our behalf.",
      },
      {
        heading: "Public visibility",
        body:
          "Usernames, display names, submitted rankings, and stats may be visible on public leaderboards and profile pages according to contest timing and release rules. " +
          "Do not include sensitive personal information in public profile fields.",
      },
      {
        heading: "AI and automated processing",
        body:
          "AI Competitor rankings and automated scoring workflows process contest data to generate and grade AI submissions. " +
          "AI profiles are labeled and governed by our AI Disclosure.",
      },
      {
        heading: "Data retention",
        body:
          "We retain account, contest, and leaderboard records for as long as needed to operate the service, comply with law, and maintain historical results integrity.",
      },
      {
        heading: "Security",
        body:
          "We use industry-standard measures appropriate to the service, including encrypted transport (HTTPS) and access controls. No method of transmission or storage is completely secure.",
      },
      {
        heading: "Your choices",
        body:
          "You may update profile fields in account settings where available. You may request account deletion subject to operational and legal retention needs.",
      },
      {
        heading: "Account deletion",
        body:
          "Contact us to request deletion of your account. Some contest history may remain in aggregated or de-identified leaderboard archives where required for integrity of past results.",
      },
      {
        heading: "Children and minors",
        body:
          `${PRODUCT} is not directed to children under 13. Accounts require ${ELIGIBILITY_AGE_STANDARD}.`,
      },
      {
        heading: "Policy changes",
        body:
          "We may update this Privacy Policy. The Last updated date will change when we do. Material changes may require renewed acceptance where applicable.",
      },
      contactSection(),
    ],
  },
  {
    title: "Eligibility",
    description: "Who may participate in RankEyeQ contests.",
    requiresReview: true,
    requiresAcceptance: false,
    effectiveDate: POLICY_LAST_UPDATED,
    lastUpdated: POLICY_LAST_UPDATED,
    sections: [
      {
        heading: "Free-to-play",
        body: NO_WAGERING_DISCLAIMER,
      },
      {
        heading: "Age requirement",
        body: ELIGIBILITY_SUMMARY,
      },
      {
        heading: "Location and law",
        body: ELIGIBILITY_JURISDICTION_NOTICE,
      },
      {
        heading: "One account per person",
        body:
          "Each human participant should maintain only one account unless we authorize otherwise. Shared, automated, or fraudulent accounts may be removed.",
      },
      {
        heading: "Contest integrity",
        body:
          "You must follow published contest rules, lock timing, and submission requirements. Attempts to manipulate results or circumvent locks are prohibited.",
      },
      contactSection(),
    ],
  },
  {
    title: "Responsible Play",
    description: "Free participation and no real-money wagering.",
    requiresReview: true,
    requiresAcceptance: false,
    effectiveDate: POLICY_LAST_UPDATED,
    lastUpdated: POLICY_LAST_UPDATED,
    sections: [
      {
        heading: "Free to play",
        body:
          `${PRODUCT} is free to use. We do not charge entry fees for standard weekly ranking contests described on the site.`,
      },
      {
        heading: "No wagering",
        body: NO_WAGERING_DISCLAIMER,
      },
      {
        heading: "No betting account",
        body:
          `${PRODUCT} does not create a sportsbook account, accept deposits for wagering, or place bets on your behalf.`,
      },
      {
        heading: "Skill comparison and entertainment",
        body:
          "Rankings, EYEQ Scores, leaderboards, and AI comparisons are provided for competition, entertainment, and skill comparison — not as gambling products or financial instruments.",
      },
      {
        heading: "Related SNG LABS products",
        body:
          "Other products in the SNG LABS ecosystem may discuss odds or betting-adjacent topics. " +
          `${PRODUCT} remains a separate free-to-play ranking product with no wagering.`,
      },
      contactSection(),
    ],
  },
  {
    title: "Community Guidelines",
    description: "Standards for profiles, social features, and fair play.",
    requiresReview: true,
    requiresAcceptance: false,
    effectiveDate: POLICY_LAST_UPDATED,
    lastUpdated: POLICY_LAST_UPDATED,
    sections: [
      {
        heading: "Be respectful",
        body:
          "Treat other Humans, Experts, and labeled AI Competitors as part of the same transparent competition. Harassment, hate speech, and threats are prohibited.",
      },
      {
        heading: "Usernames and profile content",
        body:
          "Choose appropriate usernames and bios. Do not impersonate real people, brands, or other participants. Offensive or misleading profile content may be removed.",
      },
      {
        heading: "Public boards and timing",
        body:
          "Respect reveal and privacy rules. Do not share another participant's private board before release windows allow.",
      },
      {
        heading: "Spam and manipulation",
        body:
          "No spam, coordinated manipulation, fake accounts, or attempts to game rankings, leaderboards, or follower systems.",
      },
      {
        heading: "Illegal content",
        body: "Do not upload or promote illegal content or activity through RankEyeQ features.",
      },
      {
        heading: "Reporting and enforcement",
        body:
          "Report concerns through our contact channel. We may warn, restrict, or remove accounts that violate these guidelines or applicable law.",
      },
      contactSection(),
    ],
  },
  {
    title: "AI Disclosure",
    description: "How AI Competitors work on RankEyeQ.",
    requiresReview: true,
    requiresAcceptance: false,
    effectiveDate: POLICY_LAST_UPDATED,
    lastUpdated: POLICY_LAST_UPDATED,
    sections: [
      {
        heading: "AI Competitors are not human",
        body:
          "AI Competitor profiles are automated participants. They are visibly labeled and are not real human accounts.",
      },
      {
        heading: "How AI rankings are created",
        body:
          "AI rankings may be generated using AI systems and prepared or submitted through RankEyeQ administrative workflows. " +
          "AI does not independently operate the product outside those recorded processes.",
      },
      {
        heading: "Scoring parity",
        body:
          "AI submissions are graded with the same RankEyeQ scoring methodology as comparable Human and Expert rankers for the same contest.",
      },
      {
        heading: "No professional advice",
        body:
          "AI rankings are not guaranteed to be accurate, authoritative, or suitable as betting, fantasy roster, or professional advice.",
      },
      {
        heading: "Models and providers may change",
        body:
          "AI models, prompts, or providers may change over time. Historical AI results remain tied to the recorded submission for that week where practical.",
      },
      {
        heading: "Transparency on leaderboards",
        body:
          "Leaderboards and filters distinguish Humans, Experts, and AI Competitors so you can compare categories fairly.",
      },
      contactSection(),
    ],
  },
  {
    title: "Cookie Notice",
    description: "Cookies and analytics used by RankEyeQ today.",
    requiresReview: true,
    requiresAcceptance: false,
    effectiveDate: POLICY_LAST_UPDATED,
    lastUpdated: POLICY_LAST_UPDATED,
    sections: [
      {
        heading: "Authentication cookies",
        body:
          "RankEyeQ uses session cookies required to keep you signed in. These are set by our authentication system (Auth.js / NextAuth with database-backed sessions).",
      },
      {
        heading: "Analytics",
        body:
          "We currently emit basic server-side analytics events (for example, signup and submission events) through application logging. " +
          "We do not load third-party advertising pixels or sell data to ad networks. If we add third-party analytics later, we will update this notice.",
      },
      {
        heading: "Your choices",
        body:
          "You can sign out to end your session. Browser controls may block cookies, but authentication may not work without session cookies.",
      },
      {
        heading: "No cookie consent banner today",
        body:
          "Because we currently use only essential session cookies and internal operational analytics, we do not display a separate cookie consent banner. " +
          "We will reassess if our tooling changes.",
      },
      contactSection(),
    ],
  },
];
