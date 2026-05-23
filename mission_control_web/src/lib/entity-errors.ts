export function entitySaveErrorMessage(error: unknown): string {
  const fallback = "Entity update failed.";
  const message = error instanceof Error ? error.message : String(error ?? "");
  const jsonStart = message.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(message.slice(jsonStart)) as { detail?: unknown };
      if (typeof parsed.detail === "string" && parsed.detail.trim()) return parsed.detail;
    } catch {
      // Fall through to the status-stripped message below.
    }
  }
  return message.replace(/^\d{3}:\s*/, "").trim() || fallback;
}
