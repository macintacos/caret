// `review.band` owns no browser key — it is a config.toml key the daemon holds. This is
// the synchronous holder the registry's daemon-backed field closes over in its read(),
// which App seeds from GET /api/config on load.

// Default-on, matching the schema default for `[review] band`.
let reviewBand = true;

/** Whether Claude Code's plan-waiting band is on, as last seeded. */
export const seededReviewBand = (): boolean => reviewBand;

/** Seed the holder from the daemon's answer (App, on load). */
export function seedReviewBand(value: boolean): void {
  reviewBand = value;
}
