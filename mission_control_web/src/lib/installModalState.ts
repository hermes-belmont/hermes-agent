import { getDeferredInstallPrompt, isSafariWithManifestSupport, isStandaloneDisplayMode, type BeforeInstallPromptEvent } from "@/lib/installPrompt";

export type InstallModalState = "native" | "safari" | "unsupported" | "installed";

export function getInstallModalState(options?: { standalone?: boolean; deferredPrompt?: BeforeInstallPromptEvent | null; safari?: boolean }): InstallModalState {
  if (options?.standalone ?? isStandaloneDisplayMode()) return "installed";
  if (options?.deferredPrompt ?? getDeferredInstallPrompt()) return "native";
  if (options?.safari ?? isSafariWithManifestSupport()) return "safari";
  return "unsupported";
}
