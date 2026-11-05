// Hard limits for one exploration. The orchestrator checks these before every call.
export interface BudgetLimits {
  providerCalls: number;
  sourceOpens: number;
  llmCalls: number;
  llmMaxTokens: number;
  deadlineMs: number;
}

export const DEFAULT_LIMITS: BudgetLimits = {
  providerCalls: 8,
  sourceOpens: 6,
  llmCalls: 3, // planning, the answer, the evidence map
  llmMaxTokens: 6000,
  deadlineMs: 45_000,
};

export class Budget {
  readonly limits: BudgetLimits;
  readonly started = Date.now();
  used = { providerCalls: 0, sourceOpens: 0, llmCalls: 0 };

  constructor(limits: Partial<BudgetLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  remainingMs() { return Math.max(0, this.limits.deadlineMs - (Date.now() - this.started)); }

  take(kind: keyof Budget["used"], n = 1): boolean {
    const cap = kind === "providerCalls" ? this.limits.providerCalls : kind === "sourceOpens" ? this.limits.sourceOpens : this.limits.llmCalls;
    if (this.used[kind] + n > cap || this.remainingMs() <= 0) return false;
    this.used[kind] += n;
    return true;
  }
}
