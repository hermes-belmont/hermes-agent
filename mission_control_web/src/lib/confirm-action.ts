export type RiskLevel = "low" | "medium" | "high";

export function canConfirmAction({ riskLevel, requirePhrase, typedPhrase }: { riskLevel: RiskLevel; requirePhrase?: string; typedPhrase: string }): boolean {
  if (riskLevel === "high" || requirePhrase) {
    return Boolean(requirePhrase) && typedPhrase === requirePhrase;
  }
  return true;
}
