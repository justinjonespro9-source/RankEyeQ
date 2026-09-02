import { Suspense } from "react";
import { RESULTS_SUBNAV } from "@/lib/navigation";
import { SectionSubnav } from "./SectionSubnav";

export function ResultsSubnav() {
  return (
    <Suspense fallback={<div className="mb-6 h-10" aria-hidden />}>
      <SectionSubnav links={RESULTS_SUBNAV} ariaLabel="Results" />
    </Suspense>
  );
}
