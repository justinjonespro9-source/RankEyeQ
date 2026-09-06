import { Button } from "@/components/ui/Button";
import { BrandWordmark } from "@/components/brand/BrandWordmark";
import { Container } from "@/components/layout/Container";
import { HeroProductVisual } from "@/components/home/HeroProductVisual";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div aria-hidden className="brand-navy-surface pointer-events-none absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-background/25"
      />

      <Container className="relative grid min-h-[72vh] items-center gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-12 xl:gap-16">
        <div className="max-w-2xl">
          <p className="leading-none">
            <BrandWordmark variant="dark" size="hero" />
          </p>
          <p className="mt-3 text-base font-semibold text-accent-bright sm:mt-4 sm:text-lg">
            Weekly player rankings. Real weekly receipts.
          </p>
          <h1 className="mt-5 max-w-3xl font-display text-3xl font-semibold leading-[1.15] tracking-tight text-off-white sm:mt-6 sm:text-4xl md:text-5xl">
            How good is your eye for fantasy talent?
          </h1>
          <p className="mt-3 max-w-xl text-lg font-medium text-off-white/90 sm:text-xl">
            Rank the players. Prove your EYEQ.
          </p>
          <div className="mt-4 max-w-2xl space-y-2.5 text-sm leading-relaxed text-off-white/75 sm:mt-5 sm:space-y-3 sm:text-base">
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
            <p className="font-medium text-off-white/90">
              Rank 10. Reveal the market. See who actually knows ball.
            </p>
          </div>
          <div className="mt-7 sm:mt-8">
            <Button href="/rank" size="lg" variant="primary">
              Rank This Week&apos;s Players
            </Button>
          </div>
        </div>

        <div className="lg:justify-self-end lg:w-full lg:max-w-[40rem] xl:max-w-[42rem]">
          <HeroProductVisual />
        </div>
      </Container>
    </section>
  );
}
