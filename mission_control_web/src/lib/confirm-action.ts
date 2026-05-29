export type RiskLevel = "low" | "medium" | "high";

export function canConfirmAction({ requirePhrase, typedPhrase }: { riskLevel: RiskLevel; requirePhrase?: string; typedPhrase: string }): boolean {
  if (requirePhrase) {
    return typedPhrase === requirePhrase;
  }
  return true;
}
