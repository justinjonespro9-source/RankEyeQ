import { Button } from "@/components/ui/Button";
import { BrandName } from "@/components/ui/BrandName";
import { Container } from "@/components/layout/Container";
import {
  NOT_DRAFT_OR_PROJECTIONS,
  WEEKLY_RANKINGS_EXPLAINER,
  WEEKLY_RANKINGS_SHORT,
  WEEKLY_RANKINGS_TAGLINE,
} from "@/lib/weekly-messaging";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(11,110,79,0.12),_transparent_55%),linear-gradient(135deg,#0b1f33_0%,#12324d_48%,#0b6e4f_120%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:40px_40px]"
      />

      <Container className="relative flex min-h-[78vh] flex-col justify-center py-16 sm:py-20">
        <p className="font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl md:text-6xl">
          <BrandName accentClassName="text-[#7dceb0]" />
        </p>
        <p className="mt-4 text-lg font-semibold text-[#7dceb0] sm:text-xl">
          {WEEKLY_RANKINGS_TAGLINE}
        </p>
        <h1 className="mt-6 max-w-3xl font-display text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl md:text-5xl">
          How good is your eye for fantasy talent?
        </h1>
        <p className="mt-4 max-w-xl text-lg font-medium text-white/90 sm:text-xl">
          Rank the players. Prove your EYEQ.
        </p>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/80 sm:text-lg">
          {WEEKLY_RANKINGS_EXPLAINER} Compete against the Community, Experts, and
          AI. {NOT_DRAFT_OR_PROJECTIONS}
        </p>
        <p className="mt-3 max-w-xl text-sm text-white/70">{WEEKLY_RANKINGS_SHORT}</p>
        <div className="mt-8">
          <Button href="/rank" size="lg" className="bg-white text-ink hover:bg-white/90">
            Rank This Week&apos;s Slate
          </Button>
        </div>
      </Container>
    </section>
  );
}
