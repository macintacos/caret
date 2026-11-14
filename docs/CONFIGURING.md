# caret — Configuring

*Audience: users and contributors tuning caret — the supported platforms, the config file,
the `CARET_*` environment variables, and plan formatting.*

Part of the deep reference behind [README.md](../README.md). For what caret is, how to
install it, and basic usage, start there.

## Theme files

A theme file is a JSON file that describes one caret theme: its name, whether it is light
or dark, the colors of caret's interface, and the colors used to highlight code and,
optionally, the plan's markdown. A theme file is self-contained. caret derives everything
else it needs, such as hairline rules, selection washes, and chip tints, from the colors
the file names. A theme reaches caret either from its
[themes folder](#where-caret-finds-theme-files) or by [uploading it](#uploading-a-theme)
in the Appearance settings, which writes it into the folder. Each theme appears in the
Appearance theme picker for its scheme: a dropped file after a page reload, an uploaded
one straight away. When a slot's selected theme stops loading, the slot shows caret's
theme for that scheme and keeps the selection, so restoring the file brings it back.

caret's built-in themes ship as theme files in
[`ui/src/lib/themes/`](../ui/src/lib/themes/); copying one is a good starting point for
your own — give the copy its own `id`.

### Where caret finds theme files

caret reads theme files from `$XDG_CONFIG_HOME/caret/themes`, or `~/.config/caret/themes`
when `XDG_CONFIG_HOME` is unset. caret rereads the folder each time a page loads, so
adding, editing, or deleting a file takes effect on the next page load, without a restart.
A missing or empty folder is fine.

caret reads only the `*.json` files directly in the folder, including symlinks to files.
It ignores everything else: subfolders, other extensions, and names that start with `.`.

caret skips a file, and reports an error that names it, when the file:

- cannot be read, for example because of its permissions;
- is larger than 64 KiB;
- is not valid JSON, or fails the validation described below;
- uses the `id` of a built-in theme: `caret-dark`, `caret-light`, `catppuccin-latte`,
  `catppuccin-frappe`, `catppuccin-macchiato`, `catppuccin-mocha`, `dracula`,
  `github-light`, `github-dark`, `dawnfox`, or `duskfox`;
- shares its `id` with another file. caret skips every file with that `id`.

The Appearance settings list each file that didn't load, with its errors, under the theme
pickers.

### Uploading a theme

The upload control in the Appearance settings checks a file against the same rules and
saves it into the themes folder as `<id>.json`, named from its `id`, never from the
uploaded file's name. A file that fails shows its errors, and caret saves nothing. caret
rejects the `id` of a built-in theme.

Uploading an `id` that another file already declares replaces that theme: caret writes
`<id>.json` and removes the other files. If caret can't remove one of those other files,
it still saves the upload and names the file it left; caret loads neither until you delete
that file.

caret refuses the upload when `<id>.json` already holds a different theme that caret
loads. If caret skips that file, because its `id` is built in or another file declares it
too, the upload replaces it.

There is no delete control. To remove a theme, delete its file from the folder.

### Top-level fields

| Field     | Required | Value                                                                                    |
| --------- | -------- | ---------------------------------------------------------------------------------------- |
| `$schema` | No       | A URL to the JSON Schema, for editor support. caret ignores it.                          |
| `id`      | Yes      | A lowercase slug of letters, digits, and single dashes, like `my-theme`. At most 64 characters. |
| `label`   | Yes      | The name shown in Settings. 1 to 64 characters, not all whitespace.                      |
| `scheme`  | Yes      | `"light"` or `"dark"`.                                                                   |
| `palette` | Yes      | The interface colors, below.                                                             |
| `syntax`  | Yes      | The code highlighting roles, below.                                                      |
| `markdown` | No      | The markdown element styles, below.                                                      |

### `palette`

These 13 colors are required:

| Field          | What it colors                                                                      |
| -------------- | ----------------------------------------------------------------------------------- |
| `paper`        | The page surface. In dark it is the darkest of the three surfaces; in light it sits between `raised` and `sunk`. |
| `raised`       | The lightest surface in either scheme: cards, dialogs, the plan pane.               |
| `sunk`         | Code blocks and the diff body: lifted off `paper` in dark, recessed in light.       |
| `ink`          | Body text.                                                                          |
| `inkSoft`      | Secondary text.                                                                     |
| `inkFaint`     | Metadata.                                                                           |
| `accent`       | The current selection.                                                              |
| `accentBright` | The accent's hover step, a shade further from `paper`: hovers, links, inline code.  |
| `accentInk`    | Text drawn on top of `accent`.                                                      |
| `neutral`      | A mid-tone neutral, used for the mark on an orphaned comment.                       |
| `ok`           | Success and additions.                                                              |
| `danger`       | Errors and deletions.                                                               |
| `attention`    | The "look here" hue: the notification dot and the version-count badge.              |

These 9 hue overrides are optional. Each one moves a derived color onto a different hue;
caret still decides how strong it is.

| Field           | What it colors                       | Default            |
| --------------- | ------------------------------------ | ------------------ |
| `ruleHue`       | The two hairline rules               | `ink`              |
| `washHue`       | The selection wash                   | `accent`           |
| `markHue`       | The two highlight marks              | `washHue`, then `accent` |
| `chipBoldHue`   | The bold chip in the plan view       | `ink`              |
| `chipItalicHue` | The italic chip in the plan view     | `inkSoft`          |
| `chipCodeHue`   | The inline-code chip in the plan view | `neutral`         |
| `chipLinkHue`   | The link chip in the plan view       | `accentBright`     |
| `chipRefHue`    | The file-reference chip in the plan view | `ok`           |
| `chipSkillHue`  | The skill chip in the plan view      | `attention`        |

### `syntax`

Each role is an object with a `color` and an optional `fontStyle`, a list of any of
`"italic"`, `"bold"`, `"underline"`, and `"strikethrough"`. A role without `fontStyle`
takes none from another role, but keeps the style of a comment or emphasized text it sits
in.

These 11 roles are required:

| Role | What it colors | Scopes |
| --- | --- | --- |
| `comment` | Comments | `comment`, `punctuation.definition.comment`, `string.comment` |
| `punctuation` | Punctuation and separators | `punctuation`, `punctuation.separator`, `punctuation.terminator`, `punctuation.accessor` |
| `variable` | Variables and constants | `variable.other.readwrite`, `variable`, `variable.other`, `variable.other.constant`, `meta.definition.variable`, `support.variable` |
| `property` | Object properties and keys | `variable.other.property`, `variable.other.object.property`, `meta.object-literal.key`, `support.type.property-name` |
| `attribute` | Markup attributes | `entity.other.attribute-name`, `meta.attribute` |
| `keyword` | Keywords and storage modifiers | `keyword`, `keyword.control`, `keyword.operator.new`, `keyword.operator.expression`, `storage`, `storage.type`, `storage.modifier` |
| `function` | Function names and calls | `entity.name.function`, `support.function`, `meta.function-call`, `variable.function` |
| `type` | Types, classes, and namespaces | `entity.name.type`, `entity.name.class`, `entity.other.inherited-class`, `entity.name.namespace`, `support.type`, `support.class` |
| `string` | Strings | `string`, `string.quoted`, `string.template`, `punctuation.definition.string`, `constant.other.symbol` |
| `escape` | String escapes and regular expressions | `constant.character.escape`, `string.regexp` |
| `number` | Numbers and language constants such as `true` and `null` | `constant.numeric`, `constant.language`, `support.constant` |

These 9 roles are optional. A file that omits one paints it with the role it falls back
to, so add one only to set it apart.

| Role | What it colors | Scopes | Falls back to |
| --- | --- | --- | --- |
| `operator` | Operators | `keyword.operator` | `punctuation` |
| `bracket` | Braces | `meta.brace` | `punctuation` |
| `parameter` | Function parameters | `variable.parameter` | `variable` |
| `languageVariable` | `this`, `self`, and similar | `variable.language` | `keyword` |
| `tag` | Markup tag names | `entity.name.tag` | `keyword` |
| `tagPunctuation` | Markup tag brackets | `punctuation.definition.tag` | `keyword` |
| `builtinFunction` | Built-in functions | `support.function.builtin` | `function` |
| `builtinType` | Built-in and primitive types | `support.type.primitive`, `support.type.builtin` | `type` |
| `interpolation` | Template interpolation delimiters | `punctuation.definition.template-expression` | `escape` |

### `markdown`

The plan's source view renders it as markdown source, and these optional styles color its
elements. Each is an object with a `color` and an optional `fontStyle`, the same shape as
a syntax role. A file that omits an element, or the whole `markdown` object, paints it as
caret does by default.

| Element                  | What it colors                               | Source view default         | Comment editor default |
| ------------------------ | -------------------------------------------- | --------------------------- | ---------------------- |
| `heading`                | A heading, its `#` markers included          | `accent`                    | `ink`, bold            |
| `heading1` to `heading6` | A markdown heading of that level             | `heading`                   | `heading`              |
| `code`                   | Inline code, and the body of a fenced block  | `accentBright`              | `ink`                  |
| `link`                   | A link's text                                | `ink` mixed toward `accent` | `accent`               |
| `bold`                   | Bold text, between its `**` markers          | `ink`                       | `ink`                  |
| `italic`                 | Italic text, between its `_` or `*` markers  | `ink`                       | `ink`                  |
| `listMarker`             | A list's bullet and an ordered item's number | `inkSoft` and `inkFaint`    | `inkFaint`             |
| `quote`                  | Blockquote text                              | `ink`, slightly faded       | `inkSoft`              |

A markdown heading level without a style of its own takes `heading`'s. A level's style
replaces `heading` whole, `fontStyle` included, so a level that names no `fontStyle` takes
none from it. A setext heading is level 1 under `===` and level 2 under `---`. Headings in
other formats, such as reStructuredText, AsciiDoc, Org, and MDX, in a fenced block or a
previewed file, carry no level caret reads, so `heading` styles every one of them.

A few elements keep part of their look whatever the style says:

- Bold text stays bold, italic text stays italic, and a link keeps its underline, dotted
  in the plan view, and, in the source view, its chip. A `fontStyle` adds to these.
- A heading style sets the heading's weight on every surface, so name `"bold"` for a bold
  heading.
- A styled `quote` paints at full strength, since its color already sets it apart.
- The `**`, `_`, and backtick markers keep their own color.
- A fenced block's body takes the `code` color but not its `fontStyle`.

The chip tint behind bold, italic, inline code, and link text comes from the `chip*Hue`
[palette](#palette) overrides, not from these styles.

The plan's preview applies these styles too. Unstyled, it differs from the source view
default in three ways: a heading is semibold, a quote is `inkSoft` rather than faded, and
a link or emphasis draws no chip. It leaves a fenced block's body to its own highlighting,
so `code` colors only inline code there.

The comment editor applies these styles too. There, text nested in a heading, link, or
quote takes that element's color, and in a heading its weight too. A fenced block that
names its language takes the editor's own code colors rather than `code`.

### Colors and errors

Every color is a six-digit hex color, `#rrggbb`, in either case. Shorthand (`#fff`), alpha
(`#rrggbbaa`), and color names are rejected.

caret rejects a file with any unknown field. For an invalid file, it reports one line per
failing field, as `path: message`, for example
`palette.paper: must be a hex color like #1a2b3c`.

### Example

This is caret's own dark theme as a theme file:

```json
{
  "$schema": "https://raw.githubusercontent.com/macintacos/caret/HEAD/docs/theme.schema.json",
  "id": "caret-dark",
  "label": "caret dark",
  "scheme": "dark",
  "palette": {
    "paper": "#0a0806",
    "raised": "#15110d",
    "sunk": "#100d0a",
    "ink": "#f7f2ea",
    "inkSoft": "#bcb0a1",
    "inkFaint": "#918576",
    "accent": "#ff8f3d",
    "accentBright": "#ffb277",
    "accentInk": "#0a0806",
    "neutral": "#9a8c7e",
    "ok": "#4ed056",
    "danger": "#f65a6f",
    "attention": "#3fbda9",
    "ruleHue": "#f2e7d5",
    "washHue": "#f2842f",
    "markHue": "#ffa64d",
    "chipLinkHue": "#f56f8e",
    "chipSkillHue": "#6ec4e4"
  },
  "syntax": {
    "comment": { "color": "#7f7466", "fontStyle": ["italic"] },
    "punctuation": { "color": "#b0a094" },
    "variable": { "color": "#ece2d4" },
    "property": { "color": "#a3d4ec" },
    "attribute": { "color": "#f5834f" },
    "keyword": { "color": "#dd7a6c" },
    "function": { "color": "#ecc25c" },
    "type": { "color": "#6ec4e4" },
    "string": { "color": "#92d474" },
    "escape": { "color": "#f56f8e" },
    "number": { "color": "#4cbbc8" }
  },
  "markdown": {
    "heading": { "color": "#ecc25c", "fontStyle": ["bold"] },
    "heading1": { "color": "#ecc25c", "fontStyle": ["bold", "italic"] },
    "heading2": { "color": "#92d474", "fontStyle": ["bold"] },
    "heading3": { "color": "#3fbda9", "fontStyle": ["bold"] },
    "heading4": { "color": "#6ec4e4", "fontStyle": ["bold"] },
    "heading5": { "color": "#ecc25c" },
    "heading6": { "color": "#bcb0a1", "fontStyle": ["italic"] },
    "code": { "color": "#a3d4ec" },
    "link": { "color": "#f56f8e" },
    "bold": { "color": "#dd7a6c" },
    "italic": { "color": "#3fbda9" },
    "listMarker": { "color": "#ecc25c" },
    "quote": { "color": "#92d474", "fontStyle": ["italic"] }
  }
}
```

### Editor support

Set `$schema` to
`https://raw.githubusercontent.com/macintacos/caret/HEAD/docs/theme.schema.json`, as the
example does. An editor that understands JSON Schema, such as VS Code, then completes
field names and flags invalid values as you type.

### Converting a VS Code theme

`caret convert-theme <file> [-o, --out <file>]` turns a VS Code color theme JSON into a
caret theme file. It prints the theme file to stdout unless `--out` names a file, and
writes into the [themes folder](#where-caret-finds-theme-files) only when `--out` points
there. `--out` must name a file, not a folder:

```sh
caret convert-theme dracula.json --out ~/.config/caret/themes/dracula-custom.json
```

The input may be JSONC: comments and trailing commas are fine. The command maps:

- [`syntax`](#syntax): every role, required and optional, from the theme's token rules, as
  VS Code would color each scope. A token no rule colors takes the theme's
  `editor.foreground`, or VS Code's default for its `type` when it sets none, with a
  `syntax:` note. A `tokenColors` rule with no `scope` is ignored, as VS Code does.
- `scheme`: from the theme's `type`. `dark` and `hcDark` become `dark`; `light` and
  `hcLight` become `light`.
- [`palette`](#palette): the required colors, a best-effort pick from the theme's
  `colors`. A color with no clear source, missing or translucent, takes caret's own color
  for the scheme and is printed as a `palette.<key>:` note. The optional hues are left
  out, so caret derives them.
- `id` and `label`: from the theme's `name`, or the file name when it has none. An `id`
  that matches a built-in theme gets `-custom` appended, with a note.

Notes go to stderr as `caret convert-theme: <note>` and leave the exit code 0. The command
refuses a theme that uses `include`, a `tokenColors` that names a `.tmTheme` file, a theme
with no recognized `type`, or a theme it can't map (it says why); it prints the reason and
exits 1 without writing anything. Treat the output as a starting point: check the noted
colors and tweak what you like.

## Plan formatting (rumdl)

caret canonicalizes every incoming plan by reflowing it to a 90-column MD013 shape with
[rumdl](https://github.com/rvben/rumdl). Link URLs are exempt from that measurement —
nothing can break inside a URL, so counting it would only fragment the prose around it —
which means a line carrying a link runs wider than 90 and scrolls in the plan reader.

rumdl is not a runtime prerequisite: caret installs the pinned binary (v0.3.2) into
`$XDG_STATE_HOME/caret/rumdl/` and verifies its checksum, so formatting behaves the same
however caret was installed (Claude plugin or OpenCode).

> [!IMPORTANT]
> caret only ever formats with that one binary, at that one path. A `rumdl` on your `PATH`
> is never used: which version reflows your plans must not depend on what the machine
> happens to have installed.

How that plays out:

- **Reuse is version-pinned.** The binary already at caret's path is reused only when it
  reports exactly the pinned version; an older copy left by a previous caret, or a file
  that won't run, is replaced.
- **Install warms it; the first plan is the fallback.** `caret install` runs that check at
  install time so the first plan doesn't pay the download, and a failure there is a
  warning rather than a failed install — a later plan retries.
- **A failed acquisition backs off for ten minutes.** Retrying every plan would re-fetch
  several megabytes on the path that creates your review and fail again anyway, so a
  failed download suppresses the next attempt for ten minutes; plans submitted inside that
  window are stored unformatted. Fix the cause (connectivity, a rate limit) and the next
  attempt after the window succeeds — or run `caret install` to retry immediately.
- **Formatting never loses a plan.** If a plan can't be formatted (rumdl missing, offline,
  an unsupported platform, or formatting outran its two-second budget), caret stores it
  unchanged and logs one warning.
- **`CARET_RUMDL_BIN` opts out of the download, not the pin.** Point it at a rumdl of your
  own and caret uses that instead of downloading — but only when it reports the pinned
  version too; anything else falls back to the download.
