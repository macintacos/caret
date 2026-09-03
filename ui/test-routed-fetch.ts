import { type LogCapture, logCapture } from "@ui/test-helpers.ts";

export type Respond = (url: string, options: RequestInit | undefined) => Promise<Response>;

/** The default responder: an empty 204, until a test points `getRespond()`
 * somewhere more interesting. */
export const emptyResponse: Respond = () => Promise.resolve(new Response(null, { status: 204 }));

/** Wire a URL-routing fetch double: `/api/logs` POSTs are captured via
 * `logCapture` (test-helpers.ts), and every other URL is answered by calling
 * whatever `getRespond()` currently returns — so a test can reassign its own
 * `respond` local per case without re-wiring the stub. */
export function installRoutedFetch(getRespond: () => Respond): LogCapture {
  return logCapture((url, options) => getRespond()(url, options));
}

/** A 200 JSON response, the shape every api.ts client call parses. */
export function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
