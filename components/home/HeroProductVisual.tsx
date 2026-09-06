import type { ReactNode } from "react";
import { HeroLaptopConsensusScreen } from "@/components/home/HeroLaptopConsensusScreen";
import { HeroPhoneRankScreen } from "@/components/home/HeroPhoneRankScreen";

/**
 * Decorative hero product visual: phone Rank builder + laptop Consensus.
 * Static demo data only — no Prisma / live contest queries.
 */
export function HeroProductVisual() {
  return (
    <div
      aria-hidden
      className="relative mx-auto w-full max-w-[22rem] select-none md:min-h-[22rem] md:max-w-none lg:min-h-[24rem]"
    >
      {/* Laptop — behind / beside; tablet+ */}
      <div className="pointer-events-none relative mx-auto hidden w-full max-w-[34rem] md:block lg:max-w-none">
        <LaptopFrame>
          <HeroLaptopConsensusScreen />
        </LaptopFrame>
      </div>

      {/* Phone — solo on mobile; overlaps laptop on md+ */}
      <div className="pointer-events-none relative z-10 mx-auto w-[11.75rem] sm:w-[12.75rem] md:absolute md:bottom-1 md:right-0 md:mx-0 md:w-[13.25rem] lg:-right-2 lg:bottom-2 xl:right-1">
        <PhoneFrame>
          <HeroPhoneRankScreen />
        </PhoneFrame>
      </div>

      <p className="relative z-10 mt-3 text-center text-[10px] font-medium uppercase tracking-[0.16em] text-off-white/45 md:mt-4 md:pr-[14rem] md:text-left">
        Example product view
      </p>
    </div>
  );
}

function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[1.65rem] border border-ink/90 bg-ink p-[5px] shadow-[0_22px_50px_-20px_rgba(0,0,0,0.65)]">
      <div className="relative overflow-hidden rounded-[1.35rem] bg-background">
        <div className="absolute inset-x-0 top-0 z-20 flex justify-center pt-1.5">
          <span className="h-1.5 w-14 rounded-full bg-ink/80" />
        </div>
        <div className="h-[27rem] pt-3 sm:h-[28.5rem] md:h-[30rem]">{children}</div>
      </div>
    </div>
  );
}

function LaptopFrame({ children }: { children: ReactNode }) {
  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-lg border border-ink/70 bg-ink p-[6px] shadow-[0_28px_60px_-28px_rgba(0,0,0,0.55)] md:w-[86%] lg:w-[88%]">
        <div className="mb-1.5 flex items-center gap-1.5 px-1">
          <span className="h-1.5 w-1.5 rounded-full bg-off-white/25" />
          <span className="h-1.5 w-1.5 rounded-full bg-off-white/25" />
          <span className="h-1.5 w-1.5 rounded-full bg-off-white/25" />
          <span className="ml-2 h-1.5 flex-1 rounded-sm bg-midnight" />
        </div>
        <div className="h-[17rem] overflow-hidden rounded-md bg-background sm:h-[18.5rem] lg:h-[20rem]">
          {children}
        </div>
      </div>
      <div className="mx-auto h-2 w-[94%] rounded-b-md bg-ink/85 md:w-[90%]" />
      <div className="mx-auto h-1 w-[28%] rounded-b-sm bg-ink/60" />
    </div>
  );
}
