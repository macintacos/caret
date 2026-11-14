# Theme file format

_Audience: anyone writing or checking a caret theme file._

A theme file is a JSON file that describes one caret theme: its name, whether it is light
or dark, the colors of the review page, and the colors used to highlight code and,
optionally, the plan's markdown. A theme file is self-contained. caret derives everything
else it needs, such as hairline rules, selection washes, and chip tints, from the colors
the file names. A theme reaches caret either from its
[themes folder](#where-caret-finds-theme-files) or by
[uploading it](../how-to/make-a-theme.md#upload-a-theme) in the Appearance settings, which
writes it into the folder. Each theme appears in the Appearance theme picker for its
scheme: a dropped file after a page reload, an uploaded one straight away. When the theme
selected for light or dark stops loading, caret shows its own theme for that scheme and
keeps the selection, so restoring the file brings it back.

## Where caret finds theme files

caret reads theme files from `$XDG_CONFIG_HOME/caret/themes`, or `~/.config/caret/themes`
when `XDG_CONFIG_HOME` is unset. caret rereads the folder each time the review page loads,
so adding, editing, or deleting a file takes effect on the next page load, without a
restart. A missing or empty folder is fine.

caret reads only the `*.json` files directly in the folder, including symlinks to files.
It ignores everything else: subfolders, other extensions, and names that start with `.`.

caret skips a file, and reports an error that names it, when the file:

- cannot be read, for example because of its permissions;
- is larger than 64 KiB;
- is not valid JSON, or fails the validation described below;
- uses the `id` of a [built-in theme](built-in-themes.md);
- shares its `id` with another file. caret skips every file with that `id`.

The Appearance settings list each file that didn't load, with its errors, under the theme
pickers.

## Top-level fields

| Field     | Required | Value                                                                                    |
| --------- | -------- | ---------------------------------------------------------------------------------------- |
| `$schema` | No       | A URL to the JSON Schema, for editor support. caret ignores it.                          |
| `id`      | Yes      | A lowercase slug of letters, digits, and single dashes, like `my-theme`. At most 64 characters. |
| `label`   | Yes      | The name shown in Settings. 1 to 64 characters, not all whitespace.                      |
| `scheme`  | Yes      | `"light"` or `"dark"`.                                                                   |
| `palette` | Yes      | The interface colors, below.                                                             |
| `syntax`  | Yes      | The code highlighting roles, below.                                                      |
| `markdown` | No      | The markdown element styles, below.                                                      |

## `palette`

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

## `syntax`

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

## `markdown`

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
none from it. A heading underlined with `===` is level 1, and one underlined with `---` is
level 2. Headings in other formats, such as reStructuredText, AsciiDoc, Org, and MDX, in a
fenced block or a previewed file, carry no level caret reads, so `heading` styles every
one of them.

A few elements keep part of their look whatever the style says:

- Bold text stays bold, italic text stays italic, and a link keeps its underline, dotted
  in the plan view, and, in the source view, its chip. A `fontStyle` adds to these.
- A heading style sets the heading's weight on every surface, so name `"bold"` for a
    bold heading.
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

## Colors and errors

Every color is a six-digit hex color, `#rrggbb`, in either case. Shorthand (`#fff`), alpha
(`#rrggbbaa`), and color names are rejected.

caret rejects a file with any unknown field. For an invalid file, it reports one line per
failing field, as `path: message`, for example
`palette.paper: must be a hex color like #1a2b3c`.

## Example

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
