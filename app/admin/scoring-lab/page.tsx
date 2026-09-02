import type { Metadata } from "next";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { ScoringLab } from "@/components/admin/ScoringLab";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";

export const metadata: Metadata = {
  title: "Scoring Lab",
  description:
    "Development-only RankEyeQ scoring simulator for evaluating leaderboard intuition.",
};

export default function ScoringLabPage() {
  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/scoring-lab" />
      <SectionHeading
        eyebrow="Internal tooling"
        title="Scoring lab"
        description="Compare predefined Top-10 ranking styles against a fixed actual board to judge whether EYEQ scores feel intuitive."
        action={<Badge tone="warning">Dev only</Badge>}
      />
      <ScoringLab />
    </Container>
  );
}
