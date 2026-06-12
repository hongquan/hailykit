/**
 * COCOMO 81 organic-mode effort/cost estimate — same model and defaults as scc.
 *
 * Calibrated on 1980s waterfall projects: the output is a replacement-cost
 * order of magnitude, not a bid. Always surfaced with a "directional" caveat.
 */

export interface CocomoEstimate {
  /** Person-months of effort (COCOMO 81 organic: 2.4 × KLOC^1.05). */
  effortMonths: number;
  /** Calendar months (2.5 × effort^0.38). */
  scheduleMonths: number;
  /** Average team size (effort / schedule). */
  people: number;
  /** Estimated cost in salary currency units. */
  cost: number;
  salary: number;
}

export const DEFAULT_SALARY = 56286; // scc's default average annual wage (USD)

const OVERHEAD = 2.4; // scc's overhead multiplier on top of raw salary cost

export function cocomo(ncloc: number, salary: number = DEFAULT_SALARY): CocomoEstimate {
  const kloc = ncloc / 1000;
  const effortMonths = kloc > 0 ? 2.4 * Math.pow(kloc, 1.05) : 0;
  const scheduleMonths = effortMonths > 0 ? 2.5 * Math.pow(effortMonths, 0.38) : 0;
  const people = scheduleMonths > 0 ? effortMonths / scheduleMonths : 0;
  const cost = effortMonths * (salary / 12) * OVERHEAD;
  return { effortMonths, scheduleMonths, people, cost, salary };
}
