// The code ui/compare-themes.ts highlights. Across the five languages it exercises every
// syntax role's canonical scope (role-scopes.ts), so a role the conversion gets wrong shows
// up as drift.

export interface ThemeSample {
  lang: string;
  code: string;
}

const TYPESCRIPT = `/** A reviewer's verdict on one plan. */
export interface Verdict {
  approved: boolean;
  comments: readonly string[];
}

// Count the verdicts that carry a comment.
export function countCommented(verdicts: Verdict[], limit = 10): number {
  let total = 0;
  for (const verdict of verdicts) {
    if (verdict.comments.length > 0 && total < limit) total += 1;
  }
  return total;
}

class Reviewer {
  constructor(private readonly name: string) {}
  greet = (): string => \`Hello, \${this.name}!\\n\`;
}

const pattern = /^EXC-\\d+$/u;
const reviewer = new Reviewer("ada");
console.log(reviewer.greet(), pattern.test("EXC-1983"), null, true, 0x1f);
`;

const MARKDOWN = `# Review notes

Some *emphasis*, some **strong text**, and \`inline code\`.

- See [the plan](https://example.com/plan) first.
- Then read <kbd class="key" title="Enter">Enter</kbd> to approve.

## Snippet

\`\`\`ts
const answer: number = 42;
\`\`\`
`;

const JSON_SAMPLE = `{
  "name": "caret",
  "version": "1.2.3",
  "private": true,
  "workers": 4,
  "ratio": 0.75,
  "parent": null,
  "tags": ["review", "plan\\ttool"],
  "engines": { "bun": ">=1.2" }
}
`;

const SHELL = `#!/usr/bin/env bash
# Print every plan under a directory.
set -euo pipefail

list_plans() {
  local dir="$1"
  for plan in "$dir"/*.md; do
    if [[ -f "$plan" ]]; then
      echo "plan: $plan"
    fi
  done
}

count=0
list_plans "\${HOME}/plans" && count=$((count + 1))
printf '%s\\n' "done: $count"
`;

const DIFF = `--- a/src/review.ts
+++ b/src/review.ts
@@ -1,6 +1,7 @@
 import { approve } from "./approve.ts";
-const limit = 10;
+const limit = 20;
+const retries = 3;
 export function review(plan: string) {
   return approve(plan, limit);
 }
`;

export const THEME_SAMPLES: readonly ThemeSample[] = [
  { lang: "typescript", code: TYPESCRIPT },
  { lang: "markdown", code: MARKDOWN },
  { lang: "json", code: JSON_SAMPLE },
  { lang: "shellscript", code: SHELL },
  { lang: "diff", code: DIFF },
];
