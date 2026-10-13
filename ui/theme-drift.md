# Theme conversion drift

Each bundled vendor theme against its conversion onto caret's syntax roles, over the
sample in `ui/theme-sample.ts`. Regenerate with
`bun ui/compare-themes.ts && mise run format`. On the converted side, Markdown structure
(headings, inline code, fences) and diff lines take `syntaxShikiTheme`'s fixed chrome
rules rather than roles, so those rows show drift no role change removes.

| Theme | Differing tokens | Tokens |
| --- | --- | --- |
| catppuccin-latte | 121 | 314 |
| catppuccin-frappe | 121 | 314 |
| catppuccin-macchiato | 121 | 314 |
| catppuccin-mocha | 121 | 314 |
| dracula | 122 | 300 |
| github-light-default | 89 | 275 |
| github-dark-default | 102 | 282 |
| dawnfox | 106 | 294 |
| duskfox | 117 | 302 |

## catppuccin-latte

| Language | Line | Token | Original | Converted |
| --- | --- | --- | --- | --- |
| typescript | 3 | `:` | #179299 | #7c7f93 |
| typescript | 3 | `boolean` | #8839ef | #df8e1d italic |
| typescript | 4 | `:` | #179299 | #7c7f93 |
| typescript | 4 | `string` | #8839ef | #df8e1d italic |
| typescript | 4 | `[]` | #df8e1d italic | #7c7f93 |
| typescript | 8 | `verdicts` | #e64553 italic | #4c4f69 |
| typescript | 8 | `:` | #179299 | #7c7f93 |
| typescript | 8 | `[]` | #df8e1d italic | #7c7f93 |
| typescript | 8 | `limit` | #e64553 italic | #4c4f69 |
| typescript | 8 | `=` | #179299 | #7c7f93 |
| typescript | 8 | `:` | #179299 | #7c7f93 |
| typescript | 8 | `number` | #8839ef | #df8e1d italic |
| typescript | 9 | `=` | #179299 | #7c7f93 |
| typescript | 10 | `(` | #4c4f69 | #7c7f93 |
| typescript | 10 | `)` | #4c4f69 | #7c7f93 |
| typescript | 11 | `(` | #4c4f69 | #7c7f93 |
| typescript | 11 | `.` | #179299 | #7c7f93 |
| typescript | 11 | `.` | #179299 | #7c7f93 |
| typescript | 11 | `>` | #179299 | #7c7f93 |
| typescript | 11 | `&&` | #179299 | #7c7f93 |
| typescript | 11 | `<` | #179299 | #7c7f93 |
| typescript | 11 | `)` | #4c4f69 | #7c7f93 |
| typescript | 11 | `+=` | #179299 | #7c7f93 |
| typescript | 17 | `name` | #e64553 italic | #4c4f69 |
| typescript | 17 | `:` | #179299 | #7c7f93 |
| typescript | 17 | `string` | #8839ef | #df8e1d italic |
| typescript | 18 | `=` | #179299 | #7c7f93 |
| typescript | 18 | `:` | #179299 | #7c7f93 |
| typescript | 18 | `string` | #8839ef | #df8e1d italic |
| typescript | 18 | `=>` | #179299 | #8839ef |
| typescript | 18 | `${` | #7c7f93 | #ea76cb |
| typescript | 18 | `this` | #d20f39 | #8839ef |
| typescript | 18 | `.` | #179299 | #7c7f93 |
| typescript | 18 | `}` | #7c7f93 | #ea76cb |
| typescript | 21 | `=` | #179299 | #7c7f93 |
| typescript | 21 | `/` | #ea76cb | #40a02b |
| typescript | 21 | `EXC-` | #4c4f69 | #ea76cb |
| typescript | 21 | `+` | #179299 | #7c7f93 |
| typescript | 21 | `/` | #ea76cb | #40a02b |
| typescript | 22 | `=` | #179299 | #7c7f93 |
| typescript | 22 | `new` | #8839ef bold | #8839ef |
| typescript | 22 | `(` | #4c4f69 | #7c7f93 |
| typescript | 22 | `)` | #4c4f69 | #7c7f93 |
| typescript | 23 | `console` | #4c4f69 | #4c4f69 italic |
| typescript | 23 | `.` | #179299 | #7c7f93 italic |
| typescript | 23 | `(` | #4c4f69 | #7c7f93 |
| typescript | 23 | `reviewer` | #4c4f69 | #4c4f69 italic |
| typescript | 23 | `.` | #179299 | #7c7f93 italic |
| typescript | 23 | `()` | #4c4f69 | #7c7f93 |
| typescript | 23 | `pattern` | #4c4f69 | #4c4f69 italic |
| typescript | 23 | `.` | #179299 | #7c7f93 italic |
| typescript | 23 | `(` | #4c4f69 | #7c7f93 |
| typescript | 23 | `)` | #4c4f69 | #7c7f93 |
| typescript | 23 | `null` | #8839ef | #fe640b |
| typescript | 23 | `)` | #4c4f69 | #7c7f93 |
| markdown | 1 | `# Review notes` | #d20f39 | #8839ef bold |
| markdown | 3 | `*` | #7c7f93 | #7c7f93 italic |
| markdown | 3 | `emphasis` | #d20f39 italic | #4c4f69 italic |
| markdown | 3 | `*` | #7c7f93 | #7c7f93 italic |
| markdown | 3 | `**` | #7c7f93 | #7c7f93 bold |
| markdown | 3 | `strong text` | #d20f39 bold | #4c4f69 bold |
| markdown | 3 | `**` | #7c7f93 | #7c7f93 bold |
| markdown | 3 | `inline code` | #40a02b | #7287fd |
| markdown | 5 | `-` | #179299 | #7c7f93 |
| markdown | 5 | `[` | #7287fd | #7c7f93 |
| markdown | 5 | `the plan` | #7287fd | #40a02b |
| markdown | 5 | `]` | #7287fd | #7c7f93 |
| markdown | 5 | `https://example.com/plan` | #1e66f5 | #4c4f69 |
| markdown | 6 | `-` | #179299 | #7c7f93 |
| markdown | 8 | `## Snippet` | #fe640b | #8839ef bold |
| markdown | 11 | `:` | #179299 | #7c7f93 |
| markdown | 11 | `number` | #8839ef | #df8e1d italic |
| markdown | 11 | `=` | #179299 | #7c7f93 |
| json | 2 | `"` | #7c7f93 | #7c7f93 italic |
| json | 2 | `name` | #1e66f5 | #4c4f69 italic |
| json | 2 | `"` | #7c7f93 | #7c7f93 italic |
| json | 3 | `"` | #7c7f93 | #7c7f93 italic |
| json | 3 | `version` | #1e66f5 | #4c4f69 italic |
| json | 3 | `"` | #7c7f93 | #7c7f93 italic |
| json | 4 | `"` | #7c7f93 | #7c7f93 italic |
| json | 4 | `private` | #1e66f5 | #4c4f69 italic |
| json | 4 | `"` | #7c7f93 | #7c7f93 italic |
| json | 5 | `"` | #7c7f93 | #7c7f93 italic |
| json | 5 | `workers` | #1e66f5 | #4c4f69 italic |
| json | 5 | `"` | #7c7f93 | #7c7f93 italic |
| json | 6 | `"` | #7c7f93 | #7c7f93 italic |
| json | 6 | `ratio` | #1e66f5 | #4c4f69 italic |
| json | 6 | `"` | #7c7f93 | #7c7f93 italic |
| json | 7 | `"` | #7c7f93 | #7c7f93 italic |
| json | 7 | `parent` | #1e66f5 | #4c4f69 italic |
| json | 7 | `"` | #7c7f93 | #7c7f93 italic |
| json | 8 | `"` | #7c7f93 | #7c7f93 italic |
| json | 8 | `tags` | #1e66f5 | #4c4f69 italic |
| json | 8 | `"` | #7c7f93 | #7c7f93 italic |
| json | 9 | `"` | #7c7f93 | #7c7f93 italic |
| json | 9 | `engines` | #1e66f5 | #4c4f69 italic |
| json | 9 | `"` | #7c7f93 | #7c7f93 italic |
| json | 9 | `"` | #7c7f93 | #7c7f93 italic |
| json | 9 | `bun` | #1e66f5 | #4c4f69 italic |
| json | 9 | `"` | #7c7f93 | #7c7f93 italic |
| shellscript | 1 | `#!/usr/bin/env bash` | #ea76cb italic | #7c7f93 italic |
| shellscript | 3 | `set` | #d20f39 italic | #1e66f5 italic |
| shellscript | 6 | `=` | #179299 | #7c7f93 |
| shellscript | 6 | `$1` | #e64553 italic | #4c4f69 |
| shellscript | 8 | `-f` | #179299 | #7c7f93 |
| shellscript | 9 | `echo` | #d20f39 italic | #1e66f5 italic |
| shellscript | 14 | `=` | #179299 | #7c7f93 |
| shellscript | 15 | `${` | #4c4f69 | #7c7f93 |
| shellscript | 15 | `}` | #4c4f69 | #7c7f93 |
| shellscript | 15 | `=` | #179299 | #7c7f93 |
| shellscript | 16 | `printf` | #d20f39 italic | #1e66f5 italic |
| diff | 1 | `---` | #1e66f5 | #7c7f93 italic |
| diff | 1 | `a/src/review.ts` | #1e66f5 | #d20f39 italic |
| diff | 2 | `+++` | #1e66f5 | #7c7f93 italic |
| diff | 2 | `b/src/review.ts` | #1e66f5 | #40a02b italic |
| diff | 3 | `@@` | #7c7f93 | #7c7f93 italic |
| diff | 3 | `-1,6 +1,7` | #4c4f69 | #7c7f93 italic |
| diff | 3 | `@@` | #7c7f93 | #7c7f93 italic |
| diff | 5 | `-` | #7c7f93 | #d20f39 |
| diff | 6 | `+` | #7c7f93 | #40a02b |
| diff | 7 | `+` | #7c7f93 | #40a02b |

## catppuccin-frappe

| Language | Line | Token | Original | Converted |
| --- | --- | --- | --- | --- |
| typescript | 3 | `:` | #81c8be | #949cbb |
| typescript | 3 | `boolean` | #ca9ee6 | #e5c890 italic |
| typescript | 4 | `:` | #81c8be | #949cbb |
| typescript | 4 | `string` | #ca9ee6 | #e5c890 italic |
| typescript | 4 | `[]` | #e5c890 italic | #949cbb |
| typescript | 8 | `verdicts` | #ea999c italic | #c6d0f5 |
| typescript | 8 | `:` | #81c8be | #949cbb |
| typescript | 8 | `[]` | #e5c890 italic | #949cbb |
| typescript | 8 | `limit` | #ea999c italic | #c6d0f5 |
| typescript | 8 | `=` | #81c8be | #949cbb |
| typescript | 8 | `:` | #81c8be | #949cbb |
| typescript | 8 | `number` | #ca9ee6 | #e5c890 italic |
| typescript | 9 | `=` | #81c8be | #949cbb |
| typescript | 10 | `(` | #c6d0f5 | #949cbb |
| typescript | 10 | `)` | #c6d0f5 | #949cbb |
| typescript | 11 | `(` | #c6d0f5 | #949cbb |
| typescript | 11 | `.` | #81c8be | #949cbb |
| typescript | 11 | `.` | #81c8be | #949cbb |
| typescript | 11 | `>` | #81c8be | #949cbb |
| typescript | 11 | `&&` | #81c8be | #949cbb |
| typescript | 11 | `<` | #81c8be | #949cbb |
| typescript | 11 | `)` | #c6d0f5 | #949cbb |
| typescript | 11 | `+=` | #81c8be | #949cbb |
| typescript | 17 | `name` | #ea999c italic | #c6d0f5 |
| typescript | 17 | `:` | #81c8be | #949cbb |
| typescript | 17 | `string` | #ca9ee6 | #e5c890 italic |
| typescript | 18 | `=` | #81c8be | #949cbb |
| typescript | 18 | `:` | #81c8be | #949cbb |
| typescript | 18 | `string` | #ca9ee6 | #e5c890 italic |
| typescript | 18 | `=>` | #81c8be | #ca9ee6 |
| typescript | 18 | `${` | #949cbb | #f4b8e4 |
| typescript | 18 | `this` | #e78284 | #ca9ee6 |
| typescript | 18 | `.` | #81c8be | #949cbb |
| typescript | 18 | `}` | #949cbb | #f4b8e4 |
| typescript | 21 | `=` | #81c8be | #949cbb |
| typescript | 21 | `/` | #f4b8e4 | #a6d189 |
| typescript | 21 | `EXC-` | #c6d0f5 | #f4b8e4 |
| typescript | 21 | `+` | #81c8be | #949cbb |
| typescript | 21 | `/` | #f4b8e4 | #a6d189 |
| typescript | 22 | `=` | #81c8be | #949cbb |
| typescript | 22 | `new` | #ca9ee6 bold | #ca9ee6 |
| typescript | 22 | `(` | #c6d0f5 | #949cbb |
| typescript | 22 | `)` | #c6d0f5 | #949cbb |
| typescript | 23 | `console` | #c6d0f5 | #c6d0f5 italic |
| typescript | 23 | `.` | #81c8be | #949cbb italic |
| typescript | 23 | `(` | #c6d0f5 | #949cbb |
| typescript | 23 | `reviewer` | #c6d0f5 | #c6d0f5 italic |
| typescript | 23 | `.` | #81c8be | #949cbb italic |
| typescript | 23 | `()` | #c6d0f5 | #949cbb |
| typescript | 23 | `pattern` | #c6d0f5 | #c6d0f5 italic |
| typescript | 23 | `.` | #81c8be | #949cbb italic |
| typescript | 23 | `(` | #c6d0f5 | #949cbb |
| typescript | 23 | `)` | #c6d0f5 | #949cbb |
| typescript | 23 | `null` | #ca9ee6 | #ef9f76 |
| typescript | 23 | `)` | #c6d0f5 | #949cbb |
| markdown | 1 | `# Review notes` | #e78284 | #ca9ee6 bold |
| markdown | 3 | `*` | #949cbb | #949cbb italic |
| markdown | 3 | `emphasis` | #e78284 italic | #c6d0f5 italic |
| markdown | 3 | `*` | #949cbb | #949cbb italic |
| markdown | 3 | `**` | #949cbb | #949cbb bold |
| markdown | 3 | `strong text` | #e78284 bold | #c6d0f5 bold |
| markdown | 3 | `**` | #949cbb | #949cbb bold |
| markdown | 3 | `inline code` | #a6d189 | #babbf1 |
| markdown | 5 | `-` | #81c8be | #949cbb |
| markdown | 5 | `[` | #babbf1 | #949cbb |
| markdown | 5 | `the plan` | #babbf1 | #a6d189 |
| markdown | 5 | `]` | #babbf1 | #949cbb |
| markdown | 5 | `https://example.com/plan` | #8caaee | #c6d0f5 |
| markdown | 6 | `-` | #81c8be | #949cbb |
| markdown | 8 | `## Snippet` | #ef9f76 | #ca9ee6 bold |
| markdown | 11 | `:` | #81c8be | #949cbb |
| markdown | 11 | `number` | #ca9ee6 | #e5c890 italic |
| markdown | 11 | `=` | #81c8be | #949cbb |
| json | 2 | `"` | #949cbb | #949cbb italic |
| json | 2 | `name` | #8caaee | #c6d0f5 italic |
| json | 2 | `"` | #949cbb | #949cbb italic |
| json | 3 | `"` | #949cbb | #949cbb italic |
| json | 3 | `version` | #8caaee | #c6d0f5 italic |
| json | 3 | `"` | #949cbb | #949cbb italic |
| json | 4 | `"` | #949cbb | #949cbb italic |
| json | 4 | `private` | #8caaee | #c6d0f5 italic |
| json | 4 | `"` | #949cbb | #949cbb italic |
| json | 5 | `"` | #949cbb | #949cbb italic |
| json | 5 | `workers` | #8caaee | #c6d0f5 italic |
| json | 5 | `"` | #949cbb | #949cbb italic |
| json | 6 | `"` | #949cbb | #949cbb italic |
| json | 6 | `ratio` | #8caaee | #c6d0f5 italic |
| json | 6 | `"` | #949cbb | #949cbb italic |
| json | 7 | `"` | #949cbb | #949cbb italic |
| json | 7 | `parent` | #8caaee | #c6d0f5 italic |
| json | 7 | `"` | #949cbb | #949cbb italic |
| json | 8 | `"` | #949cbb | #949cbb italic |
| json | 8 | `tags` | #8caaee | #c6d0f5 italic |
| json | 8 | `"` | #949cbb | #949cbb italic |
| json | 9 | `"` | #949cbb | #949cbb italic |
| json | 9 | `engines` | #8caaee | #c6d0f5 italic |
| json | 9 | `"` | #949cbb | #949cbb italic |
| json | 9 | `"` | #949cbb | #949cbb italic |
| json | 9 | `bun` | #8caaee | #c6d0f5 italic |
| json | 9 | `"` | #949cbb | #949cbb italic |
| shellscript | 1 | `#!/usr/bin/env bash` | #f4b8e4 italic | #949cbb italic |
| shellscript | 3 | `set` | #e78284 italic | #8caaee italic |
| shellscript | 6 | `=` | #81c8be | #949cbb |
| shellscript | 6 | `$1` | #ea999c italic | #c6d0f5 |
| shellscript | 8 | `-f` | #81c8be | #949cbb |
| shellscript | 9 | `echo` | #e78284 italic | #8caaee italic |
| shellscript | 14 | `=` | #81c8be | #949cbb |
| shellscript | 15 | `${` | #c6d0f5 | #949cbb |
| shellscript | 15 | `}` | #c6d0f5 | #949cbb |
| shellscript | 15 | `=` | #81c8be | #949cbb |
| shellscript | 16 | `printf` | #e78284 italic | #8caaee italic |
| diff | 1 | `---` | #8caaee | #949cbb italic |
| diff | 1 | `a/src/review.ts` | #8caaee | #e78284 italic |
| diff | 2 | `+++` | #8caaee | #949cbb italic |
| diff | 2 | `b/src/review.ts` | #8caaee | #a6d189 italic |
| diff | 3 | `@@` | #949cbb | #949cbb italic |
| diff | 3 | `-1,6 +1,7` | #c6d0f5 | #949cbb italic |
| diff | 3 | `@@` | #949cbb | #949cbb italic |
| diff | 5 | `-` | #949cbb | #e78284 |
| diff | 6 | `+` | #949cbb | #a6d189 |
| diff | 7 | `+` | #949cbb | #a6d189 |

## catppuccin-macchiato

| Language | Line | Token | Original | Converted |
| --- | --- | --- | --- | --- |
| typescript | 3 | `:` | #8bd5ca | #939ab7 |
| typescript | 3 | `boolean` | #c6a0f6 | #eed49f italic |
| typescript | 4 | `:` | #8bd5ca | #939ab7 |
| typescript | 4 | `string` | #c6a0f6 | #eed49f italic |
| typescript | 4 | `[]` | #eed49f italic | #939ab7 |
| typescript | 8 | `verdicts` | #ee99a0 italic | #cad3f5 |
| typescript | 8 | `:` | #8bd5ca | #939ab7 |
| typescript | 8 | `[]` | #eed49f italic | #939ab7 |
| typescript | 8 | `limit` | #ee99a0 italic | #cad3f5 |
| typescript | 8 | `=` | #8bd5ca | #939ab7 |
| typescript | 8 | `:` | #8bd5ca | #939ab7 |
| typescript | 8 | `number` | #c6a0f6 | #eed49f italic |
| typescript | 9 | `=` | #8bd5ca | #939ab7 |
| typescript | 10 | `(` | #cad3f5 | #939ab7 |
| typescript | 10 | `)` | #cad3f5 | #939ab7 |
| typescript | 11 | `(` | #cad3f5 | #939ab7 |
| typescript | 11 | `.` | #8bd5ca | #939ab7 |
| typescript | 11 | `.` | #8bd5ca | #939ab7 |
| typescript | 11 | `>` | #8bd5ca | #939ab7 |
| typescript | 11 | `&&` | #8bd5ca | #939ab7 |
| typescript | 11 | `<` | #8bd5ca | #939ab7 |
| typescript | 11 | `)` | #cad3f5 | #939ab7 |
| typescript | 11 | `+=` | #8bd5ca | #939ab7 |
| typescript | 17 | `name` | #ee99a0 italic | #cad3f5 |
| typescript | 17 | `:` | #8bd5ca | #939ab7 |
| typescript | 17 | `string` | #c6a0f6 | #eed49f italic |
| typescript | 18 | `=` | #8bd5ca | #939ab7 |
| typescript | 18 | `:` | #8bd5ca | #939ab7 |
| typescript | 18 | `string` | #c6a0f6 | #eed49f italic |
| typescript | 18 | `=>` | #8bd5ca | #c6a0f6 |
| typescript | 18 | `${` | #939ab7 | #f5bde6 |
| typescript | 18 | `this` | #ed8796 | #c6a0f6 |
| typescript | 18 | `.` | #8bd5ca | #939ab7 |
| typescript | 18 | `}` | #939ab7 | #f5bde6 |
| typescript | 21 | `=` | #8bd5ca | #939ab7 |
| typescript | 21 | `/` | #f5bde6 | #a6da95 |
| typescript | 21 | `EXC-` | #cad3f5 | #f5bde6 |
| typescript | 21 | `+` | #8bd5ca | #939ab7 |
| typescript | 21 | `/` | #f5bde6 | #a6da95 |
| typescript | 22 | `=` | #8bd5ca | #939ab7 |
| typescript | 22 | `new` | #c6a0f6 bold | #c6a0f6 |
| typescript | 22 | `(` | #cad3f5 | #939ab7 |
| typescript | 22 | `)` | #cad3f5 | #939ab7 |
| typescript | 23 | `console` | #cad3f5 | #cad3f5 italic |
| typescript | 23 | `.` | #8bd5ca | #939ab7 italic |
| typescript | 23 | `(` | #cad3f5 | #939ab7 |
| typescript | 23 | `reviewer` | #cad3f5 | #cad3f5 italic |
| typescript | 23 | `.` | #8bd5ca | #939ab7 italic |
| typescript | 23 | `()` | #cad3f5 | #939ab7 |
| typescript | 23 | `pattern` | #cad3f5 | #cad3f5 italic |
| typescript | 23 | `.` | #8bd5ca | #939ab7 italic |
| typescript | 23 | `(` | #cad3f5 | #939ab7 |
| typescript | 23 | `)` | #cad3f5 | #939ab7 |
| typescript | 23 | `null` | #c6a0f6 | #f5a97f |
| typescript | 23 | `)` | #cad3f5 | #939ab7 |
| markdown | 1 | `# Review notes` | #ed8796 | #c6a0f6 bold |
| markdown | 3 | `*` | #939ab7 | #939ab7 italic |
| markdown | 3 | `emphasis` | #ed8796 italic | #cad3f5 italic |
| markdown | 3 | `*` | #939ab7 | #939ab7 italic |
| markdown | 3 | `**` | #939ab7 | #939ab7 bold |
| markdown | 3 | `strong text` | #ed8796 bold | #cad3f5 bold |
| markdown | 3 | `**` | #939ab7 | #939ab7 bold |
| markdown | 3 | `inline code` | #a6da95 | #b7bdf8 |
| markdown | 5 | `-` | #8bd5ca | #939ab7 |
| markdown | 5 | `[` | #b7bdf8 | #939ab7 |
| markdown | 5 | `the plan` | #b7bdf8 | #a6da95 |
| markdown | 5 | `]` | #b7bdf8 | #939ab7 |
| markdown | 5 | `https://example.com/plan` | #8aadf4 | #cad3f5 |
| markdown | 6 | `-` | #8bd5ca | #939ab7 |
| markdown | 8 | `## Snippet` | #f5a97f | #c6a0f6 bold |
| markdown | 11 | `:` | #8bd5ca | #939ab7 |
| markdown | 11 | `number` | #c6a0f6 | #eed49f italic |
| markdown | 11 | `=` | #8bd5ca | #939ab7 |
| json | 2 | `"` | #939ab7 | #939ab7 italic |
| json | 2 | `name` | #8aadf4 | #cad3f5 italic |
| json | 2 | `"` | #939ab7 | #939ab7 italic |
| json | 3 | `"` | #939ab7 | #939ab7 italic |
| json | 3 | `version` | #8aadf4 | #cad3f5 italic |
| json | 3 | `"` | #939ab7 | #939ab7 italic |
| json | 4 | `"` | #939ab7 | #939ab7 italic |
| json | 4 | `private` | #8aadf4 | #cad3f5 italic |
| json | 4 | `"` | #939ab7 | #939ab7 italic |
| json | 5 | `"` | #939ab7 | #939ab7 italic |
| json | 5 | `workers` | #8aadf4 | #cad3f5 italic |
| json | 5 | `"` | #939ab7 | #939ab7 italic |
| json | 6 | `"` | #939ab7 | #939ab7 italic |
| json | 6 | `ratio` | #8aadf4 | #cad3f5 italic |
| json | 6 | `"` | #939ab7 | #939ab7 italic |
| json | 7 | `"` | #939ab7 | #939ab7 italic |
| json | 7 | `parent` | #8aadf4 | #cad3f5 italic |
| json | 7 | `"` | #939ab7 | #939ab7 italic |
| json | 8 | `"` | #939ab7 | #939ab7 italic |
| json | 8 | `tags` | #8aadf4 | #cad3f5 italic |
| json | 8 | `"` | #939ab7 | #939ab7 italic |
| json | 9 | `"` | #939ab7 | #939ab7 italic |
| json | 9 | `engines` | #8aadf4 | #cad3f5 italic |
| json | 9 | `"` | #939ab7 | #939ab7 italic |
| json | 9 | `"` | #939ab7 | #939ab7 italic |
| json | 9 | `bun` | #8aadf4 | #cad3f5 italic |
| json | 9 | `"` | #939ab7 | #939ab7 italic |
| shellscript | 1 | `#!/usr/bin/env bash` | #f5bde6 italic | #939ab7 italic |
| shellscript | 3 | `set` | #ed8796 italic | #8aadf4 italic |
| shellscript | 6 | `=` | #8bd5ca | #939ab7 |
| shellscript | 6 | `$1` | #ee99a0 italic | #cad3f5 |
| shellscript | 8 | `-f` | #8bd5ca | #939ab7 |
| shellscript | 9 | `echo` | #ed8796 italic | #8aadf4 italic |
| shellscript | 14 | `=` | #8bd5ca | #939ab7 |
| shellscript | 15 | `${` | #cad3f5 | #939ab7 |
| shellscript | 15 | `}` | #cad3f5 | #939ab7 |
| shellscript | 15 | `=` | #8bd5ca | #939ab7 |
| shellscript | 16 | `printf` | #ed8796 italic | #8aadf4 italic |
| diff | 1 | `---` | #8aadf4 | #939ab7 italic |
| diff | 1 | `a/src/review.ts` | #8aadf4 | #ed8796 italic |
| diff | 2 | `+++` | #8aadf4 | #939ab7 italic |
| diff | 2 | `b/src/review.ts` | #8aadf4 | #a6da95 italic |
| diff | 3 | `@@` | #939ab7 | #939ab7 italic |
| diff | 3 | `-1,6 +1,7` | #cad3f5 | #939ab7 italic |
| diff | 3 | `@@` | #939ab7 | #939ab7 italic |
| diff | 5 | `-` | #939ab7 | #ed8796 |
| diff | 6 | `+` | #939ab7 | #a6da95 |
| diff | 7 | `+` | #939ab7 | #a6da95 |

## catppuccin-mocha

| Language | Line | Token | Original | Converted |
| --- | --- | --- | --- | --- |
| typescript | 3 | `:` | #94e2d5 | #9399b2 |
| typescript | 3 | `boolean` | #cba6f7 | #f9e2af italic |
| typescript | 4 | `:` | #94e2d5 | #9399b2 |
| typescript | 4 | `string` | #cba6f7 | #f9e2af italic |
| typescript | 4 | `[]` | #f9e2af italic | #9399b2 |
| typescript | 8 | `verdicts` | #eba0ac italic | #cdd6f4 |
| typescript | 8 | `:` | #94e2d5 | #9399b2 |
| typescript | 8 | `[]` | #f9e2af italic | #9399b2 |
| typescript | 8 | `limit` | #eba0ac italic | #cdd6f4 |
| typescript | 8 | `=` | #94e2d5 | #9399b2 |
| typescript | 8 | `:` | #94e2d5 | #9399b2 |
| typescript | 8 | `number` | #cba6f7 | #f9e2af italic |
| typescript | 9 | `=` | #94e2d5 | #9399b2 |
| typescript | 10 | `(` | #cdd6f4 | #9399b2 |
| typescript | 10 | `)` | #cdd6f4 | #9399b2 |
| typescript | 11 | `(` | #cdd6f4 | #9399b2 |
| typescript | 11 | `.` | #94e2d5 | #9399b2 |
| typescript | 11 | `.` | #94e2d5 | #9399b2 |
| typescript | 11 | `>` | #94e2d5 | #9399b2 |
| typescript | 11 | `&&` | #94e2d5 | #9399b2 |
| typescript | 11 | `<` | #94e2d5 | #9399b2 |
| typescript | 11 | `)` | #cdd6f4 | #9399b2 |
| typescript | 11 | `+=` | #94e2d5 | #9399b2 |
| typescript | 17 | `name` | #eba0ac italic | #cdd6f4 |
| typescript | 17 | `:` | #94e2d5 | #9399b2 |
| typescript | 17 | `string` | #cba6f7 | #f9e2af italic |
| typescript | 18 | `=` | #94e2d5 | #9399b2 |
| typescript | 18 | `:` | #94e2d5 | #9399b2 |
| typescript | 18 | `string` | #cba6f7 | #f9e2af italic |
| typescript | 18 | `=>` | #94e2d5 | #cba6f7 |
| typescript | 18 | `${` | #9399b2 | #f5c2e7 |
| typescript | 18 | `this` | #f38ba8 | #cba6f7 |
| typescript | 18 | `.` | #94e2d5 | #9399b2 |
| typescript | 18 | `}` | #9399b2 | #f5c2e7 |
| typescript | 21 | `=` | #94e2d5 | #9399b2 |
| typescript | 21 | `/` | #f5c2e7 | #a6e3a1 |
| typescript | 21 | `EXC-` | #cdd6f4 | #f5c2e7 |
| typescript | 21 | `+` | #94e2d5 | #9399b2 |
| typescript | 21 | `/` | #f5c2e7 | #a6e3a1 |
| typescript | 22 | `=` | #94e2d5 | #9399b2 |
| typescript | 22 | `new` | #cba6f7 bold | #cba6f7 |
| typescript | 22 | `(` | #cdd6f4 | #9399b2 |
| typescript | 22 | `)` | #cdd6f4 | #9399b2 |
| typescript | 23 | `console` | #cdd6f4 | #cdd6f4 italic |
| typescript | 23 | `.` | #94e2d5 | #9399b2 italic |
| typescript | 23 | `(` | #cdd6f4 | #9399b2 |
| typescript | 23 | `reviewer` | #cdd6f4 | #cdd6f4 italic |
| typescript | 23 | `.` | #94e2d5 | #9399b2 italic |
| typescript | 23 | `()` | #cdd6f4 | #9399b2 |
| typescript | 23 | `pattern` | #cdd6f4 | #cdd6f4 italic |
| typescript | 23 | `.` | #94e2d5 | #9399b2 italic |
| typescript | 23 | `(` | #cdd6f4 | #9399b2 |
| typescript | 23 | `)` | #cdd6f4 | #9399b2 |
| typescript | 23 | `null` | #cba6f7 | #fab387 |
| typescript | 23 | `)` | #cdd6f4 | #9399b2 |
| markdown | 1 | `# Review notes` | #f38ba8 | #cba6f7 bold |
| markdown | 3 | `*` | #9399b2 | #9399b2 italic |
| markdown | 3 | `emphasis` | #f38ba8 italic | #cdd6f4 italic |
| markdown | 3 | `*` | #9399b2 | #9399b2 italic |
| markdown | 3 | `**` | #9399b2 | #9399b2 bold |
| markdown | 3 | `strong text` | #f38ba8 bold | #cdd6f4 bold |
| markdown | 3 | `**` | #9399b2 | #9399b2 bold |
| markdown | 3 | `inline code` | #a6e3a1 | #b4befe |
| markdown | 5 | `-` | #94e2d5 | #9399b2 |
| markdown | 5 | `[` | #b4befe | #9399b2 |
| markdown | 5 | `the plan` | #b4befe | #a6e3a1 |
| markdown | 5 | `]` | #b4befe | #9399b2 |
| markdown | 5 | `https://example.com/plan` | #89b4fa | #cdd6f4 |
| markdown | 6 | `-` | #94e2d5 | #9399b2 |
| markdown | 8 | `## Snippet` | #fab387 | #cba6f7 bold |
| markdown | 11 | `:` | #94e2d5 | #9399b2 |
| markdown | 11 | `number` | #cba6f7 | #f9e2af italic |
| markdown | 11 | `=` | #94e2d5 | #9399b2 |
| json | 2 | `"` | #9399b2 | #9399b2 italic |
| json | 2 | `name` | #89b4fa | #cdd6f4 italic |
| json | 2 | `"` | #9399b2 | #9399b2 italic |
| json | 3 | `"` | #9399b2 | #9399b2 italic |
| json | 3 | `version` | #89b4fa | #cdd6f4 italic |
| json | 3 | `"` | #9399b2 | #9399b2 italic |
| json | 4 | `"` | #9399b2 | #9399b2 italic |
| json | 4 | `private` | #89b4fa | #cdd6f4 italic |
| json | 4 | `"` | #9399b2 | #9399b2 italic |
| json | 5 | `"` | #9399b2 | #9399b2 italic |
| json | 5 | `workers` | #89b4fa | #cdd6f4 italic |
| json | 5 | `"` | #9399b2 | #9399b2 italic |
| json | 6 | `"` | #9399b2 | #9399b2 italic |
| json | 6 | `ratio` | #89b4fa | #cdd6f4 italic |
| json | 6 | `"` | #9399b2 | #9399b2 italic |
| json | 7 | `"` | #9399b2 | #9399b2 italic |
| json | 7 | `parent` | #89b4fa | #cdd6f4 italic |
| json | 7 | `"` | #9399b2 | #9399b2 italic |
| json | 8 | `"` | #9399b2 | #9399b2 italic |
| json | 8 | `tags` | #89b4fa | #cdd6f4 italic |
| json | 8 | `"` | #9399b2 | #9399b2 italic |
| json | 9 | `"` | #9399b2 | #9399b2 italic |
| json | 9 | `engines` | #89b4fa | #cdd6f4 italic |
| json | 9 | `"` | #9399b2 | #9399b2 italic |
| json | 9 | `"` | #9399b2 | #9399b2 italic |
| json | 9 | `bun` | #89b4fa | #cdd6f4 italic |
| json | 9 | `"` | #9399b2 | #9399b2 italic |
| shellscript | 1 | `#!/usr/bin/env bash` | #f5c2e7 italic | #9399b2 italic |
| shellscript | 3 | `set` | #f38ba8 italic | #89b4fa italic |
| shellscript | 6 | `=` | #94e2d5 | #9399b2 |
| shellscript | 6 | `$1` | #eba0ac italic | #cdd6f4 |
| shellscript | 8 | `-f` | #94e2d5 | #9399b2 |
| shellscript | 9 | `echo` | #f38ba8 italic | #89b4fa italic |
| shellscript | 14 | `=` | #94e2d5 | #9399b2 |
| shellscript | 15 | `${` | #cdd6f4 | #9399b2 |
| shellscript | 15 | `}` | #cdd6f4 | #9399b2 |
| shellscript | 15 | `=` | #94e2d5 | #9399b2 |
| shellscript | 16 | `printf` | #f38ba8 italic | #89b4fa italic |
| diff | 1 | `---` | #89b4fa | #9399b2 italic |
| diff | 1 | `a/src/review.ts` | #89b4fa | #f38ba8 italic |
| diff | 2 | `+++` | #89b4fa | #9399b2 italic |
| diff | 2 | `b/src/review.ts` | #89b4fa | #a6e3a1 italic |
| diff | 3 | `@@` | #9399b2 | #9399b2 italic |
| diff | 3 | `-1,6 +1,7` | #cdd6f4 | #9399b2 italic |
| diff | 3 | `@@` | #9399b2 | #9399b2 italic |
| diff | 5 | `-` | #9399b2 | #f38ba8 |
| diff | 6 | `+` | #9399b2 | #a6e3a1 |
| diff | 7 | `+` | #9399b2 | #a6e3a1 |

## dracula

| Language | Line | Token | Original | Converted |
| --- | --- | --- | --- | --- |
| typescript | 3 | `:` | #ff79c6 | #f8f8f2 |
| typescript | 4 | `:` | #ff79c6 | #f8f8f2 |
| typescript | 8 | `verdicts` | #ffb86c italic | #f8f8f2 |
| typescript | 8 | `:` | #ff79c6 | #f8f8f2 |
| typescript | 8 | `limit` | #ffb86c italic | #f8f8f2 |
| typescript | 8 | `=` | #ff79c6 | #f8f8f2 |
| typescript | 8 | `:` | #ff79c6 | #f8f8f2 |
| typescript | 9 | `=` | #ff79c6 | #f8f8f2 |
| typescript | 11 | `>` | #ff79c6 | #f8f8f2 |
| typescript | 11 | `&&` | #ff79c6 | #f8f8f2 |
| typescript | 11 | `<` | #ff79c6 | #f8f8f2 |
| typescript | 11 | `+=` | #ff79c6 | #f8f8f2 |
| typescript | 16 | `Reviewer` | #8be9fd | #8be9fd italic |
| typescript | 17 | `name` | #ffb86c italic | #f8f8f2 |
| typescript | 17 | `:` | #ff79c6 | #f8f8f2 |
| typescript | 18 | `=` | #ff79c6 | #f8f8f2 |
| typescript | 18 | `:` | #ff79c6 | #f8f8f2 |
| typescript | 18 | `this` | #bd93f9 italic | #ff79c6 |
| typescript | 21 | `=` | #ff79c6 | #f8f8f2 |
| typescript | 21 | `/` | #ff5555 | #f1fa8c |
| typescript | 21 | `EXC-` | #f1fa8c | #ff79c6 |
| typescript | 21 | `\d` | #bd93f9 | #ff79c6 |
| typescript | 21 | `+` | #ff79c6 | #f8f8f2 |
| typescript | 21 | `/` | #ff5555 | #f1fa8c |
| typescript | 22 | `=` | #ff79c6 | #f8f8f2 |
| typescript | 22 | `new` | #ff79c6 bold | #ff79c6 |
| typescript | 22 | `"` | #e9f284 | #f1fa8c |
| typescript | 22 | `"` | #e9f284 | #f1fa8c |
| typescript | 23 | `"` | #e9f284 | #f1fa8c |
| typescript | 23 | `"` | #e9f284 | #f1fa8c |
| markdown | 3 | `emphasis` | #f1fa8c italic | #f8f8f2 italic |
| markdown | 3 | `strong text` | #ffb86c bold | #f8f8f2 bold |
| markdown | 3 | `inline code` | #50fa7b | #d6acff |
| markdown | 5 | `the plan` | #ff79c6 | #f1fa8c |
| markdown | 5 | `https://example.com/plan` | #8be9fd underline | #f8f8f2 |
| markdown | 11 | `:` | #ff79c6 | #f8f8f2 |
| markdown | 11 | `=` | #ff79c6 | #f8f8f2 |
| json | 2 | `"` | #8be9fe | #f8f8f2 italic |
| json | 2 | `name` | #8be9fd | #f8f8f2 italic |
| json | 2 | `"` | #8be9fe | #f8f8f2 italic |
| json | 2 | `:` | #ff79c6 | #f8f8f2 |
| json | 2 | `"` | #e9f284 | #f1fa8c |
| json | 2 | `"` | #e9f284 | #f1fa8c |
| json | 3 | `"` | #8be9fe | #f8f8f2 italic |
| json | 3 | `version` | #8be9fd | #f8f8f2 italic |
| json | 3 | `"` | #8be9fe | #f8f8f2 italic |
| json | 3 | `:` | #ff79c6 | #f8f8f2 |
| json | 3 | `"` | #e9f284 | #f1fa8c |
| json | 3 | `"` | #e9f284 | #f1fa8c |
| json | 4 | `"` | #8be9fe | #f8f8f2 italic |
| json | 4 | `private` | #8be9fd | #f8f8f2 italic |
| json | 4 | `"` | #8be9fe | #f8f8f2 italic |
| json | 4 | `:` | #ff79c6 | #f8f8f2 |
| json | 5 | `"` | #8be9fe | #f8f8f2 italic |
| json | 5 | `workers` | #8be9fd | #f8f8f2 italic |
| json | 5 | `"` | #8be9fe | #f8f8f2 italic |
| json | 5 | `:` | #ff79c6 | #f8f8f2 |
| json | 6 | `"` | #8be9fe | #f8f8f2 italic |
| json | 6 | `ratio` | #8be9fd | #f8f8f2 italic |
| json | 6 | `"` | #8be9fe | #f8f8f2 italic |
| json | 6 | `:` | #ff79c6 | #f8f8f2 |
| json | 7 | `"` | #8be9fe | #f8f8f2 italic |
| json | 7 | `parent` | #8be9fd | #f8f8f2 italic |
| json | 7 | `"` | #8be9fe | #f8f8f2 italic |
| json | 7 | `:` | #ff79c6 | #f8f8f2 |
| json | 8 | `"` | #8be9fe | #f8f8f2 italic |
| json | 8 | `tags` | #8be9fd | #f8f8f2 italic |
| json | 8 | `"` | #8be9fe | #f8f8f2 italic |
| json | 8 | `:` | #ff79c6 | #f8f8f2 |
| json | 8 | `"` | #e9f284 | #f1fa8c |
| json | 8 | `"` | #e9f284 | #f1fa8c |
| json | 8 | `"` | #e9f284 | #f1fa8c |
| json | 8 | `"` | #e9f284 | #f1fa8c |
| json | 9 | `"` | #8be9fe | #f8f8f2 italic |
| json | 9 | `engines` | #8be9fd | #f8f8f2 italic |
| json | 9 | `"` | #8be9fe | #f8f8f2 italic |
| json | 9 | `:` | #ff79c6 | #f8f8f2 |
| json | 9 | `"` | #8be9fe | #f8f8f2 italic |
| json | 9 | `bun` | #8be9fd | #f8f8f2 italic |
| json | 9 | `"` | #8be9fe | #f8f8f2 italic |
| json | 9 | `:` | #ff79c6 | #f8f8f2 |
| json | 9 | `"` | #e9f284 | #f1fa8c |
| json | 9 | `"` | #e9f284 | #f1fa8c |
| shellscript | 3 | `set` | #8be9fd | #50fa7b |
| shellscript | 3 | `-euo` | #bd93f9 | #f1fa8c |
| shellscript | 6 | `dir` | #bd93f9 | #f8f8f2 |
| shellscript | 6 | `=` | #ff79c6 | #f8f8f2 |
| shellscript | 6 | `"` | #e9f284 | #f1fa8c |
| shellscript | 6 | `$1` | #ffb86c italic | #f8f8f2 |
| shellscript | 6 | `"` | #e9f284 | #f1fa8c |
| shellscript | 7 | `plan` | #bd93f9 | #f8f8f2 |
| shellscript | 7 | `"` | #e9f284 | #f1fa8c |
| shellscript | 7 | `$dir` | #bd93f9 | #f8f8f2 |
| shellscript | 7 | `"` | #e9f284 | #f1fa8c |
| shellscript | 8 | `-f` | #ff79c6 | #f8f8f2 |
| shellscript | 8 | `"` | #e9f284 | #f1fa8c |
| shellscript | 8 | `$plan` | #bd93f9 | #f8f8f2 |
| shellscript | 8 | `"` | #e9f284 | #f1fa8c |
| shellscript | 9 | `echo` | #8be9fd | #50fa7b |
| shellscript | 9 | `"` | #e9f284 | #f1fa8c |
| shellscript | 9 | `$plan` | #bd93f9 | #f8f8f2 |
| shellscript | 9 | `"` | #e9f284 | #f1fa8c |
| shellscript | 14 | `count` | #bd93f9 | #f8f8f2 |
| shellscript | 14 | `=` | #ff79c6 | #f8f8f2 |
| shellscript | 15 | `"` | #e9f284 | #f1fa8c |
| shellscript | 15 | `${` | #f1fa8c | #f8f8f2 |
| shellscript | 15 | `HOME` | #bd93f9 | #f8f8f2 |
| shellscript | 15 | `}` | #f1fa8c | #f8f8f2 |
| shellscript | 15 | `"` | #e9f284 | #f1fa8c |
| shellscript | 15 | `count` | #bd93f9 | #f8f8f2 |
| shellscript | 15 | `=` | #ff79c6 | #f8f8f2 |
| shellscript | 16 | `printf` | #8be9fd | #50fa7b |
| shellscript | 16 | `'` | #e9f284 | #f1fa8c |
| shellscript | 16 | `'` | #e9f284 | #f1fa8c |
| shellscript | 16 | `"` | #e9f284 | #f1fa8c |
| shellscript | 16 | `$count` | #bd93f9 | #f8f8f2 |
| shellscript | 16 | `"` | #e9f284 | #f1fa8c |
| diff | 1 | `---` | #6272a4 | #f8f8f2 italic |
| diff | 1 | `a/src/review.ts` | #6272a4 | #ff5555 italic |
| diff | 2 | `+++` | #6272a4 | #f8f8f2 italic |
| diff | 2 | `b/src/review.ts` | #6272a4 | #50fa7b italic |
| diff | 3 | `@@ -1,6 +1,7 @@` | #6272a4 | #6272a4 italic |

## github-light-default

| Language | Line | Token | Original | Converted |
| --- | --- | --- | --- | --- |
| typescript | 3 | `:` | #cf222e | #1f2328 |
| typescript | 3 | `boolean` | #0550ae | #953800 |
| typescript | 4 | `:` | #cf222e | #1f2328 |
| typescript | 4 | `string` | #0550ae | #953800 |
| typescript | 8 | `:` | #cf222e | #1f2328 |
| typescript | 8 | `=` | #cf222e | #1f2328 |
| typescript | 8 | `:` | #cf222e | #1f2328 |
| typescript | 8 | `number` | #0550ae | #953800 |
| typescript | 9 | `total` | #1f2328 | #953800 |
| typescript | 9 | `=` | #cf222e | #1f2328 |
| typescript | 10 | `verdict` | #0550ae | #953800 |
| typescript | 10 | `verdicts` | #1f2328 | #953800 |
| typescript | 11 | `verdict` | #1f2328 | #953800 |
| typescript | 11 | `length` | #0550ae | #953800 |
| typescript | 11 | `>` | #cf222e | #1f2328 |
| typescript | 11 | `&&` | #cf222e | #1f2328 |
| typescript | 11 | `total` | #1f2328 | #953800 |
| typescript | 11 | `<` | #cf222e | #1f2328 |
| typescript | 11 | `limit` | #1f2328 | #953800 |
| typescript | 11 | `total` | #1f2328 | #953800 |
| typescript | 11 | `+=` | #cf222e | #1f2328 |
| typescript | 13 | `total` | #1f2328 | #953800 |
| typescript | 17 | `:` | #cf222e | #1f2328 |
| typescript | 17 | `string` | #0550ae | #953800 |
| typescript | 18 | `=` | #cf222e | #1f2328 |
| typescript | 18 | `:` | #cf222e | #1f2328 |
| typescript | 18 | `string` | #0550ae | #953800 |
| typescript | 18 | `${` | #0a3069 | #cf222e |
| typescript | 18 | `this` | #0550ae | #cf222e |
| typescript | 18 | `.` | #0a3069 | #1f2328 |
| typescript | 18 | `}` | #0a3069 | #cf222e |
| typescript | 21 | `pattern` | #0550ae | #953800 |
| typescript | 21 | `=` | #cf222e | #1f2328 |
| typescript | 21 | `EXC-` | #0a3069 | #cf222e |
| typescript | 21 | `\d` | #0550ae | #cf222e |
| typescript | 21 | `+` | #cf222e | #1f2328 |
| typescript | 22 | `reviewer` | #0550ae | #953800 |
| typescript | 22 | `=` | #cf222e | #1f2328 |
| typescript | 23 | `console` | #1f2328 | #953800 |
| typescript | 23 | `reviewer` | #1f2328 | #953800 |
| typescript | 23 | `pattern` | #1f2328 | #953800 |
| markdown | 1 | `# Review notes` | #0550ae bold | #0969da bold |
| markdown | 5 | `-` | #953800 | #1f2328 |
| markdown | 5 | `https://example.com/plan` | #1f2328 underline | #1f2328 |
| markdown | 6 | `-` | #953800 | #1f2328 |
| markdown | 8 | `## Snippet` | #0550ae bold | #0969da bold |
| markdown | 11 | `answer` | #0550ae | #953800 |
| markdown | 11 | `:` | #cf222e | #1f2328 |
| markdown | 11 | `number` | #0550ae | #953800 |
| markdown | 11 | `=` | #cf222e | #1f2328 |
| json | 2 | `"name"` | #116329 | #1f2328 |
| json | 3 | `"version"` | #116329 | #1f2328 |
| json | 4 | `"private"` | #116329 | #1f2328 |
| json | 5 | `"workers"` | #116329 | #1f2328 |
| json | 6 | `"ratio"` | #116329 | #1f2328 |
| json | 7 | `"parent"` | #116329 | #1f2328 |
| json | 8 | `"tags"` | #116329 | #1f2328 |
| json | 9 | `"engines"` | #116329 | #1f2328 |
| json | 9 | `"bun"` | #116329 | #1f2328 |
| shellscript | 3 | `set` | #0550ae | #8250df |
| shellscript | 3 | `-euo` | #0550ae | #0a3069 |
| shellscript | 6 | `dir` | #1f2328 | #953800 |
| shellscript | 6 | `=` | #cf222e | #1f2328 |
| shellscript | 6 | `$1` | #0550ae | #953800 |
| shellscript | 7 | `plan` | #1f2328 | #953800 |
| shellscript | 7 | `$dir` | #1f2328 | #953800 |
| shellscript | 8 | `-f` | #cf222e | #1f2328 |
| shellscript | 8 | `$plan` | #1f2328 | #953800 |
| shellscript | 9 | `echo` | #0550ae | #8250df |
| shellscript | 9 | `$plan` | #1f2328 | #953800 |
| shellscript | 14 | `count` | #1f2328 | #953800 |
| shellscript | 14 | `=` | #cf222e | #1f2328 |
| shellscript | 15 | `list_plans` | #953800 | #8250df |
| shellscript | 15 | `${` | #0a3069 | #1f2328 |
| shellscript | 15 | `HOME` | #1f2328 | #953800 |
| shellscript | 15 | `}` | #0a3069 | #1f2328 |
| shellscript | 15 | `count` | #1f2328 | #953800 |
| shellscript | 15 | `=` | #cf222e | #1f2328 |
| shellscript | 15 | `count` | #953800 | #8250df |
| shellscript | 16 | `printf` | #0550ae | #8250df |
| shellscript | 16 | `$count` | #1f2328 | #953800 |
| diff | 1 | `---` | #82071e | #1f2328 italic |
| diff | 1 | `a/src/review.ts` | #82071e | #d1242f italic |
| diff | 2 | `+++` | #116329 | #1f2328 italic |
| diff | 2 | `b/src/review.ts` | #116329 | #1a7f37 italic |
| diff | 3 | `@@ -1,6 +1,7 @@` | #8250df bold | #6e7781 italic |
| diff | 5 | `-const limit = 10;` | #82071e | #d1242f |
| diff | 6 | `+const limit = 20;` | #116329 | #1a7f37 |
| diff | 7 | `+const retries = 3;` | #116329 | #1a7f37 |

## github-dark-default

| Language | Line | Token | Original | Converted |
| --- | --- | --- | --- | --- |
| typescript | 3 | `:` | #ff7b72 | #e6edf3 |
| typescript | 3 | `boolean` | #79c0ff | #ffa657 |
| typescript | 4 | `:` | #ff7b72 | #e6edf3 |
| typescript | 4 | `string` | #79c0ff | #ffa657 |
| typescript | 8 | `:` | #ff7b72 | #e6edf3 |
| typescript | 8 | `=` | #ff7b72 | #e6edf3 |
| typescript | 8 | `:` | #ff7b72 | #e6edf3 |
| typescript | 8 | `number` | #79c0ff | #ffa657 |
| typescript | 9 | `total` | #e6edf3 | #ffa657 |
| typescript | 9 | `=` | #ff7b72 | #e6edf3 |
| typescript | 10 | `verdict` | #79c0ff | #ffa657 |
| typescript | 10 | `verdicts` | #e6edf3 | #ffa657 |
| typescript | 11 | `verdict` | #e6edf3 | #ffa657 |
| typescript | 11 | `length` | #79c0ff | #ffa657 |
| typescript | 11 | `>` | #ff7b72 | #e6edf3 |
| typescript | 11 | `&&` | #ff7b72 | #e6edf3 |
| typescript | 11 | `total` | #e6edf3 | #ffa657 |
| typescript | 11 | `<` | #ff7b72 | #e6edf3 |
| typescript | 11 | `limit` | #e6edf3 | #ffa657 |
| typescript | 11 | `total` | #e6edf3 | #ffa657 |
| typescript | 11 | `+=` | #ff7b72 | #e6edf3 |
| typescript | 13 | `total` | #e6edf3 | #ffa657 |
| typescript | 17 | `:` | #ff7b72 | #e6edf3 |
| typescript | 17 | `string` | #79c0ff | #ffa657 |
| typescript | 18 | `=` | #ff7b72 | #e6edf3 |
| typescript | 18 | `:` | #ff7b72 | #e6edf3 |
| typescript | 18 | `string` | #79c0ff | #ffa657 |
| typescript | 18 | `${` | #a5d6ff | #ff7b72 |
| typescript | 18 | `this` | #79c0ff | #ff7b72 |
| typescript | 18 | `.` | #a5d6ff | #e6edf3 |
| typescript | 18 | `}` | #a5d6ff | #ff7b72 |
| typescript | 21 | `pattern` | #79c0ff | #ffa657 |
| typescript | 21 | `=` | #ff7b72 | #e6edf3 |
| typescript | 21 | `EXC-` | #a5d6ff | #ff7b72 |
| typescript | 21 | `\d` | #79c0ff | #ff7b72 |
| typescript | 21 | `+` | #ff7b72 | #e6edf3 |
| typescript | 22 | `reviewer` | #79c0ff | #ffa657 |
| typescript | 22 | `=` | #ff7b72 | #e6edf3 |
| typescript | 23 | `console` | #e6edf3 | #ffa657 |
| typescript | 23 | `reviewer` | #e6edf3 | #ffa657 |
| typescript | 23 | `pattern` | #e6edf3 | #ffa657 |
| markdown | 1 | `# Review notes` | #79c0ff bold | #4493f8 bold |
| markdown | 3 | `Some` | #e6edf3 | #f0f6fc |
| markdown | 3 | `emphasis` | #e6edf3 italic | #f0f6fc italic |
| markdown | 3 | `, some` | #e6edf3 | #f0f6fc |
| markdown | 3 | `strong text` | #e6edf3 bold | #f0f6fc bold |
| markdown | 3 | `, and` | #e6edf3 | #f0f6fc |
| markdown | 3 | `.` | #e6edf3 | #f0f6fc |
| markdown | 5 | `-` | #ffa657 | #e6edf3 |
| markdown | 5 | `See` | #e6edf3 | #f0f6fc |
| markdown | 5 | `https://example.com/plan` | #e6edf3 underline | #f0f6fc |
| markdown | 5 | `first.` | #e6edf3 | #f0f6fc |
| markdown | 6 | `-` | #ffa657 | #e6edf3 |
| markdown | 6 | `Then read <kbd class="key" title="Enter">Enter</kbd> to approve.` | #e6edf3 | #f0f6fc |
| markdown | 8 | `## Snippet` | #79c0ff bold | #4493f8 bold |
| markdown | 11 | `answer` | #79c0ff | #ffa657 |
| markdown | 11 | `:` | #ff7b72 | #e6edf3 |
| markdown | 11 | `number` | #79c0ff | #ffa657 |
| markdown | 11 | `=` | #ff7b72 | #e6edf3 |
| json | 2 | `"name"` | #7ee787 | #e6edf3 |
| json | 3 | `"version"` | #7ee787 | #e6edf3 |
| json | 4 | `"private"` | #7ee787 | #e6edf3 |
| json | 5 | `"workers"` | #7ee787 | #e6edf3 |
| json | 6 | `"ratio"` | #7ee787 | #e6edf3 |
| json | 7 | `"parent"` | #7ee787 | #e6edf3 |
| json | 8 | `"tags"` | #7ee787 | #e6edf3 |
| json | 9 | `"engines"` | #7ee787 | #e6edf3 |
| json | 9 | `"bun"` | #7ee787 | #e6edf3 |
| shellscript | 3 | `set` | #79c0ff | #d2a8ff |
| shellscript | 3 | `-euo` | #79c0ff | #a5d6ff |
| shellscript | 6 | `dir` | #e6edf3 | #ffa657 |
| shellscript | 6 | `=` | #ff7b72 | #e6edf3 |
| shellscript | 6 | `$1` | #79c0ff | #ffa657 |
| shellscript | 7 | `plan` | #e6edf3 | #ffa657 |
| shellscript | 7 | `$dir` | #e6edf3 | #ffa657 |
| shellscript | 8 | `-f` | #ff7b72 | #e6edf3 |
| shellscript | 8 | `$plan` | #e6edf3 | #ffa657 |
| shellscript | 9 | `echo` | #79c0ff | #d2a8ff |
| shellscript | 9 | `$plan` | #e6edf3 | #ffa657 |
| shellscript | 14 | `count` | #e6edf3 | #ffa657 |
| shellscript | 14 | `=` | #ff7b72 | #e6edf3 |
| shellscript | 15 | `list_plans` | #ffa657 | #d2a8ff |
| shellscript | 15 | `${` | #a5d6ff | #e6edf3 |
| shellscript | 15 | `HOME` | #e6edf3 | #ffa657 |
| shellscript | 15 | `}` | #a5d6ff | #e6edf3 |
| shellscript | 15 | `count` | #e6edf3 | #ffa657 |
| shellscript | 15 | `=` | #ff7b72 | #e6edf3 |
| shellscript | 15 | `count` | #ffa657 | #d2a8ff |
| shellscript | 16 | `printf` | #79c0ff | #d2a8ff |
| shellscript | 16 | `$count` | #e6edf3 | #ffa657 |
| diff | 1 | `---` | #ffa198 | #e6edf3 italic |
| diff | 1 | `a/src/review.ts` | #ffa198 | #f85149 italic |
| diff | 2 | `+++` | #7ee787 | #e6edf3 italic |
| diff | 2 | `b/src/review.ts` | #7ee787 | #3fb950 italic |
| diff | 3 | `@@ -1,6 +1,7 @@` | #d2a8ff bold | #8b949e italic |
| diff | 4 | `import { approve } from "./approve.ts";` | #e6edf3 | #f0f6fc |
| diff | 5 | `-const limit = 10;` | #ffa198 | #f85149 |
| diff | 6 | `+const limit = 20;` | #7ee787 | #3fb950 |
| diff | 7 | `+const retries = 3;` | #7ee787 | #3fb950 |
| diff | 8 | `export function review(plan: string) {` | #e6edf3 | #f0f6fc |
| diff | 9 | `return approve(plan, limit);` | #e6edf3 | #f0f6fc |
| diff | 10 | `}` | #e6edf3 | #f0f6fc |

## dawnfox

| Language | Line | Token | Original | Converted |
| --- | --- | --- | --- | --- |
| typescript | 3 | `:` | #56949f | #4c4769 |
| typescript | 3 | `boolean` | #907aa9 | #ea9d34 italic |
| typescript | 4 | `:` | #56949f | #4c4769 |
| typescript | 4 | `string` | #907aa9 | #ea9d34 italic |
| typescript | 4 | `[]` | #ea9d34 italic | #4c4769 |
| typescript | 8 | `verdicts` | #c9709e italic | #4c4769 |
| typescript | 8 | `:` | #56949f | #4c4769 |
| typescript | 8 | `[]` | #ea9d34 italic | #4c4769 |
| typescript | 8 | `limit` | #c9709e italic | #4c4769 |
| typescript | 8 | `=` | #56949f | #4c4769 |
| typescript | 8 | `:` | #56949f | #4c4769 |
| typescript | 8 | `number` | #907aa9 | #ea9d34 italic |
| typescript | 9 | `=` | #56949f | #4c4769 |
| typescript | 11 | `.` | #56949f | #4c4769 |
| typescript | 11 | `.` | #56949f | #4c4769 |
| typescript | 11 | `>` | #56949f | #4c4769 |
| typescript | 11 | `&&` | #56949f | #4c4769 |
| typescript | 11 | `<` | #56949f | #4c4769 |
| typescript | 11 | `+=` | #56949f | #4c4769 |
| typescript | 17 | `name` | #c9709e italic | #4c4769 |
| typescript | 17 | `:` | #56949f | #4c4769 |
| typescript | 17 | `string` | #907aa9 | #ea9d34 italic |
| typescript | 18 | `=` | #56949f | #4c4769 |
| typescript | 18 | `:` | #56949f | #4c4769 |
| typescript | 18 | `string` | #907aa9 | #ea9d34 italic |
| typescript | 18 | `=>` | #56949f | #907aa9 |
| typescript | 18 | `${` | #4c4769 | #625c87 |
| typescript | 18 | `this` | #b4637a | #907aa9 |
| typescript | 18 | `.` | #56949f | #4c4769 |
| typescript | 18 | `}` | #4c4769 | #625c87 |
| typescript | 21 | `=` | #56949f | #4c4769 |
| typescript | 21 | `/` | #625c87 | #618774 |
| typescript | 21 | `EXC-` | #4c4769 | #625c87 |
| typescript | 21 | `+` | #56949f | #4c4769 |
| typescript | 21 | `/` | #625c87 | #618774 |
| typescript | 22 | `=` | #56949f | #4c4769 |
| typescript | 22 | `new` | #907aa9 bold | #907aa9 |
| typescript | 23 | `console` | #4c4769 | #4c4769 italic |
| typescript | 23 | `.` | #56949f | #4c4769 italic |
| typescript | 23 | `reviewer` | #4c4769 | #4c4769 italic |
| typescript | 23 | `.` | #56949f | #4c4769 italic |
| typescript | 23 | `pattern` | #4c4769 | #4c4769 italic |
| typescript | 23 | `.` | #56949f | #4c4769 italic |
| typescript | 23 | `null` | #907aa9 | #ea9d34 |
| markdown | 1 | `# Review notes` | #b4637a | #286983 bold |
| markdown | 3 | `*` | #837e9a | #837e9a italic |
| markdown | 3 | `emphasis` | #b4637a italic | #4c4769 italic |
| markdown | 3 | `*` | #837e9a | #837e9a italic |
| markdown | 3 | `**` | #837e9a | #837e9a bold |
| markdown | 3 | `strong text` | #b4637a bold | #4c4769 bold |
| markdown | 3 | `**` | #837e9a | #837e9a bold |
| markdown | 3 | `inline code` | #618774 | #2d81a3 |
| markdown | 5 | `-` | #56949f | #4c4769 |
| markdown | 5 | `[` | #b7bdf8 | #4c4769 |
| markdown | 5 | `the plan` | #b7bdf8 | #618774 |
| markdown | 5 | `]` | #b7bdf8 | #4c4769 |
| markdown | 5 | `https://example.com/plan` | #295e73 | #4c4769 |
| markdown | 6 | `-` | #56949f | #4c4769 |
| markdown | 8 | `## Snippet` | #ea9d34 | #286983 bold |
| markdown | 11 | `:` | #56949f | #4c4769 |
| markdown | 11 | `number` | #907aa9 | #ea9d34 italic |
| markdown | 11 | `=` | #56949f | #4c4769 |
| json | 2 | `"` | #4c4769 | #4c4769 italic |
| json | 2 | `name` | #295e73 | #4c4769 italic |
| json | 2 | `"` | #4c4769 | #4c4769 italic |
| json | 3 | `"` | #4c4769 | #4c4769 italic |
| json | 3 | `version` | #295e73 | #4c4769 italic |
| json | 3 | `"` | #4c4769 | #4c4769 italic |
| json | 4 | `"` | #4c4769 | #4c4769 italic |
| json | 4 | `private` | #295e73 | #4c4769 italic |
| json | 4 | `"` | #4c4769 | #4c4769 italic |
| json | 5 | `"` | #4c4769 | #4c4769 italic |
| json | 5 | `workers` | #295e73 | #4c4769 italic |
| json | 5 | `"` | #4c4769 | #4c4769 italic |
| json | 6 | `"` | #4c4769 | #4c4769 italic |
| json | 6 | `ratio` | #295e73 | #4c4769 italic |
| json | 6 | `"` | #4c4769 | #4c4769 italic |
| json | 7 | `"` | #4c4769 | #4c4769 italic |
| json | 7 | `parent` | #295e73 | #4c4769 italic |
| json | 7 | `"` | #4c4769 | #4c4769 italic |
| json | 8 | `"` | #4c4769 | #4c4769 italic |
| json | 8 | `tags` | #295e73 | #4c4769 italic |
| json | 8 | `"` | #4c4769 | #4c4769 italic |
| json | 9 | `"` | #4c4769 | #4c4769 italic |
| json | 9 | `engines` | #295e73 | #4c4769 italic |
| json | 9 | `"` | #4c4769 | #4c4769 italic |
| json | 9 | `"` | #4c4769 | #4c4769 italic |
| json | 9 | `bun` | #295e73 | #4c4769 italic |
| json | 9 | `"` | #4c4769 | #4c4769 italic |
| shellscript | 1 | `#!/usr/bin/env bash` | #625c87 italic | #bdbfc9 italic |
| shellscript | 3 | `set` | #b4637a italic | #295e73 italic |
| shellscript | 6 | `=` | #56949f | #4c4769 |
| shellscript | 6 | `$1` | #c9709e italic | #4c4769 |
| shellscript | 8 | `-f` | #56949f | #4c4769 |
| shellscript | 9 | `echo` | #b4637a italic | #295e73 italic |
| shellscript | 14 | `=` | #56949f | #4c4769 |
| shellscript | 15 | `=` | #56949f | #4c4769 |
| shellscript | 16 | `printf` | #b4637a italic | #295e73 italic |
| diff | 1 | `---` | #295e73 | #4c4769 italic |
| diff | 1 | `a/src/review.ts` | #295e73 | #b4637a italic |
| diff | 2 | `+++` | #295e73 | #4c4769 italic |
| diff | 2 | `b/src/review.ts` | #295e73 | #618774 italic |
| diff | 3 | `@@ -1,6 +1,7 @@` | #4c4769 | #bdbfc9 italic |
| diff | 5 | `-` | #4c4769 | #b4637a |
| diff | 6 | `+` | #4c4769 | #618774 |
| diff | 7 | `+` | #4c4769 | #618774 |

## duskfox

| Language | Line | Token | Original | Converted |
| --- | --- | --- | --- | --- |
| typescript | 3 | `:` | #9ccfd8 | #eae8ff |
| typescript | 3 | `boolean` | #c4a7e7 | #f6c177 italic |
| typescript | 4 | `:` | #9ccfd8 | #eae8ff |
| typescript | 4 | `string` | #c4a7e7 | #f6c177 italic |
| typescript | 4 | `[]` | #f6c177 italic | #eae8ff |
| typescript | 8 | `verdicts` | #d871a6 italic | #eae8ff |
| typescript | 8 | `:` | #9ccfd8 | #eae8ff |
| typescript | 8 | `[]` | #f6c177 italic | #eae8ff |
| typescript | 8 | `limit` | #d871a6 italic | #eae8ff |
| typescript | 8 | `=` | #9ccfd8 | #eae8ff |
| typescript | 8 | `:` | #9ccfd8 | #eae8ff |
| typescript | 8 | `number` | #c4a7e7 | #f6c177 italic |
| typescript | 9 | `=` | #9ccfd8 | #eae8ff |
| typescript | 11 | `.` | #9ccfd8 | #eae8ff |
| typescript | 11 | `.` | #9ccfd8 | #eae8ff |
| typescript | 11 | `>` | #9ccfd8 | #eae8ff |
| typescript | 11 | `&&` | #9ccfd8 | #eae8ff |
| typescript | 11 | `<` | #9ccfd8 | #eae8ff |
| typescript | 11 | `+=` | #9ccfd8 | #eae8ff |
| typescript | 17 | `name` | #d871a6 italic | #eae8ff |
| typescript | 17 | `:` | #9ccfd8 | #eae8ff |
| typescript | 17 | `string` | #c4a7e7 | #f6c177 italic |
| typescript | 18 | `=` | #9ccfd8 | #eae8ff |
| typescript | 18 | `:` | #9ccfd8 | #eae8ff |
| typescript | 18 | `string` | #c4a7e7 | #f6c177 italic |
| typescript | 18 | `=>` | #9ccfd8 | #c4a7e7 |
| typescript | 18 | `${` | #eae8ff | #cdcbe0 |
| typescript | 18 | `this` | #eb6f92 | #c4a7e7 |
| typescript | 18 | `.` | #9ccfd8 | #eae8ff |
| typescript | 18 | `}` | #eae8ff | #cdcbe0 |
| typescript | 21 | `=` | #9ccfd8 | #eae8ff |
| typescript | 21 | `/` | #cdcbe0 | #a3be8c |
| typescript | 21 | `EXC-` | #eae8ff | #cdcbe0 |
| typescript | 21 | `+` | #9ccfd8 | #eae8ff |
| typescript | 21 | `/` | #cdcbe0 | #a3be8c |
| typescript | 22 | `=` | #9ccfd8 | #eae8ff |
| typescript | 22 | `new` | #c4a7e7 bold | #c4a7e7 |
| typescript | 23 | `console` | #eae8ff | #eae8ff italic |
| typescript | 23 | `.` | #9ccfd8 | #eae8ff italic |
| typescript | 23 | `reviewer` | #eae8ff | #eae8ff italic |
| typescript | 23 | `.` | #9ccfd8 | #eae8ff italic |
| typescript | 23 | `pattern` | #eae8ff | #eae8ff italic |
| typescript | 23 | `.` | #9ccfd8 | #eae8ff italic |
| typescript | 23 | `null` | #c4a7e7 | #f6c177 |
| markdown | 1 | `# Review notes` | #eb6f92 | #c4a7e7 bold |
| markdown | 3 | `Some` | #eae8ff | #e0def4 |
| markdown | 3 | `*` | #817c9c | #817c9c italic |
| markdown | 3 | `emphasis` | #eb6f92 italic | #e0def4 italic |
| markdown | 3 | `*` | #817c9c | #817c9c italic |
| markdown | 3 | `, some` | #eae8ff | #e0def4 |
| markdown | 3 | `**` | #817c9c | #817c9c bold |
| markdown | 3 | `strong text` | #eb6f92 bold | #e0def4 bold |
| markdown | 3 | `**` | #817c9c | #817c9c bold |
| markdown | 3 | `, and` | #eae8ff | #e0def4 |
| markdown | 3 | `inline code` | #a3be8c | #ccb1ed |
| markdown | 3 | `.` | #eae8ff | #e0def4 |
| markdown | 5 | `-` | #9ccfd8 | #eae8ff |
| markdown | 5 | `See` | #eae8ff | #e0def4 |
| markdown | 5 | `[` | #b7bdf8 | #eae8ff |
| markdown | 5 | `the plan` | #b7bdf8 | #a3be8c |
| markdown | 5 | `]` | #b7bdf8 | #eae8ff |
| markdown | 5 | `https://example.com/plan` | #4a869c | #e0def4 |
| markdown | 5 | `first.` | #eae8ff | #e0def4 |
| markdown | 6 | `-` | #9ccfd8 | #eae8ff |
| markdown | 6 | `Then read <kbd class="key" title="Enter">Enter</kbd> to approve.` | #eae8ff | #e0def4 |
| markdown | 8 | `## Snippet` | #f6c177 | #c4a7e7 bold |
| markdown | 11 | `:` | #9ccfd8 | #eae8ff |
| markdown | 11 | `number` | #c4a7e7 | #f6c177 italic |
| markdown | 11 | `=` | #9ccfd8 | #eae8ff |
| json | 2 | `"` | #eae8ff | #eae8ff italic |
| json | 2 | `name` | #4a869c | #eae8ff italic |
| json | 2 | `"` | #eae8ff | #eae8ff italic |
| json | 3 | `"` | #eae8ff | #eae8ff italic |
| json | 3 | `version` | #4a869c | #eae8ff italic |
| json | 3 | `"` | #eae8ff | #eae8ff italic |
| json | 4 | `"` | #eae8ff | #eae8ff italic |
| json | 4 | `private` | #4a869c | #eae8ff italic |
| json | 4 | `"` | #eae8ff | #eae8ff italic |
| json | 5 | `"` | #eae8ff | #eae8ff italic |
| json | 5 | `workers` | #4a869c | #eae8ff italic |
| json | 5 | `"` | #eae8ff | #eae8ff italic |
| json | 6 | `"` | #eae8ff | #eae8ff italic |
| json | 6 | `ratio` | #4a869c | #eae8ff italic |
| json | 6 | `"` | #eae8ff | #eae8ff italic |
| json | 7 | `"` | #eae8ff | #eae8ff italic |
| json | 7 | `parent` | #4a869c | #eae8ff italic |
| json | 7 | `"` | #eae8ff | #eae8ff italic |
| json | 8 | `"` | #eae8ff | #eae8ff italic |
| json | 8 | `tags` | #4a869c | #eae8ff italic |
| json | 8 | `"` | #eae8ff | #eae8ff italic |
| json | 9 | `"` | #eae8ff | #eae8ff italic |
| json | 9 | `engines` | #4a869c | #eae8ff italic |
| json | 9 | `"` | #eae8ff | #eae8ff italic |
| json | 9 | `"` | #eae8ff | #eae8ff italic |
| json | 9 | `bun` | #4a869c | #eae8ff italic |
| json | 9 | `"` | #eae8ff | #eae8ff italic |
| shellscript | 1 | `#!/usr/bin/env bash` | #cdcbe0 italic | #4b4673 italic |
| shellscript | 3 | `set` | #eb6f92 italic | #4a869c italic |
| shellscript | 6 | `=` | #9ccfd8 | #eae8ff |
| shellscript | 6 | `$1` | #d871a6 italic | #eae8ff |
| shellscript | 8 | `-f` | #9ccfd8 | #eae8ff |
| shellscript | 9 | `echo` | #eb6f92 italic | #4a869c italic |
| shellscript | 14 | `=` | #9ccfd8 | #eae8ff |
| shellscript | 15 | `=` | #9ccfd8 | #eae8ff |
| shellscript | 16 | `printf` | #eb6f92 italic | #4a869c italic |
| diff | 1 | `---` | #4a869c | #eae8ff italic |
| diff | 1 | `a/src/review.ts` | #4a869c | #eb6f92 italic |
| diff | 2 | `+++` | #4a869c | #eae8ff italic |
| diff | 2 | `b/src/review.ts` | #4a869c | #a3be8c italic |
| diff | 3 | `@@ -1,6 +1,7 @@` | #eae8ff | #4b4673 italic |
| diff | 4 | `import { approve } from "./approve.ts";` | #eae8ff | #e0def4 |
| diff | 5 | `-` | #eae8ff | #eb6f92 |
| diff | 6 | `+` | #eae8ff | #a3be8c |
| diff | 7 | `+` | #eae8ff | #a3be8c |
| diff | 8 | `export function review(plan: string) {` | #eae8ff | #e0def4 |
| diff | 9 | `return approve(plan, limit);` | #eae8ff | #e0def4 |
| diff | 10 | `}` | #eae8ff | #e0def4 |
