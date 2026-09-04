import { Button } from "@/components/ui/Button";
import { BrandName } from "@/components/ui/BrandName";
import { Container } from "@/components/layout/Container";

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

      <Container className="relative flex min-h-[72vh] flex-col justify-center py-12 sm:py-16">
        <p className="font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl md:text-6xl">
          <BrandName accentClassName="text-[#7dceb0]" />
        </p>
        <p className="mt-3 text-base font-semibold text-[#7dceb0] sm:mt-4 sm:text-lg">
          Weekly player rankings. Real weekly receipts.
        </p>
        <h1 className="mt-5 max-w-3xl font-display text-3xl font-semibold leading-[1.15] tracking-tight text-white sm:mt-6 sm:text-4xl md:text-5xl">
          How good is your eye for fantasy talent?
        </h1>
        <p className="mt-3 max-w-xl text-lg font-medium text-white/90 sm:text-xl">
          Rank the players. Prove your EYEQ.
        </p>
        <div className="mt-4 max-w-2xl space-y-2.5 text-sm leading-relaxed text-white/80 sm:mt-5 sm:space-y-3 sm:text-base">
          <p>
            Each week, rank the QBs, RBs, WRs, TEs, and defenses you believe will
            finish highest in fantasy scoring for that NFL slate. Then RankEyeQ
            scores everyone against the actual results.
          </p>
          <p>
            Compete against the Public, Experts, Creators, and AI — all on the
            same scoreboard.
          </p>
          <p>
            No preseason rankings. No rest-of-season projections. Just fresh
            weekly calls, locked before kickoff.
          </p>
          <p className="font-medium text-white/90">
            Rank 10. Reveal the market. See who actually knows ball.
          </p>
        </div>
        <div className="mt-7 sm:mt-8">
          <Button
            href="/rank"
            size="lg"
            variant="secondary"
            className="border-transparent bg-surface text-ink hover:bg-surface-elevated hover:border-transparent"
          >
            Rank This Week&apos;s Players
          </Button>
        </div>
      </Container>
    </section>
  );
}
