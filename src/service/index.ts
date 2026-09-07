// Which supervisor caret runs under. The managers arrive as an argument rather
// than an import so the platform decision stays in one place while the values come
// from the composition layer (EXC-1167) — the same shape prodReviewDeps uses to
// hand the core an adapter capability it names nowhere.

import type { ServiceManager } from "@/service/manager.ts";

export type ServicePlatform = "darwin" | "linux";

export function selectServiceManager(
  managers: Record<ServicePlatform, ServiceManager>,
  platform: string = process.platform,
): ServiceManager {
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error(
      `caret cannot run as a resident service on ${platform} — supported: macOS (launchd) and Linux (systemd user units).`,
    );
  }
  return managers[platform];
}
