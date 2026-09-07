// Which supervisor caret runs under. The managers arrive as an argument rather
// than an import so the platform decision stays in one place while the values come
// from the composition layer (EXC-1167) — the same shape prodReviewDeps uses to
// hand the core an adapter capability it names nowhere.

import type { ServiceManager } from "@/service/manager.ts";

export type ServicePlatform = "darwin" | "linux";

/** The manager for a platform, defaulting to the current process. Throws on anything
 * but darwin/linux — residency has no third implementation, and a silent no-op would
 * leave the caller believing caret is resident. */
export function selectServiceManager(
  managers: Record<ServicePlatform, ServiceManager>,
  platform: string = process.platform,
): ServiceManager {
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error(`caret service: unsupported platform ${platform} (darwin/linux only)`);
  }
  return managers[platform];
}
