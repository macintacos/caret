# Make your own theme

*Audience: anyone who wants caret's [review page](../reference/glossary.md#review-page) in
colors of their own.*

A caret theme is one JSON file. Start from a theme caret ships or from a VS Code theme you
already like, edit its colors, then put it in caret's themes folder or upload it from
**Settings → Appearance**. The [theme file format](../reference/theme-files.md) lists
every field.

## Start from a built-in theme

caret's [built-in themes](../reference/built-in-themes.md) ship as theme files in
[`ui/src/lib/themes/`](https://github.com/macintacos/caret/tree/main/ui/src/lib/themes).
Copy one, give the copy its own `id`, then change any field the theme file format
describes.

## Start from a VS Code theme

Run `caret convert-theme <file>` to turn a VS Code color theme JSON into a caret theme
file. It prints the theme file to stdout. To write a file instead, pass `-o` or `--out`
with a file path, not a folder. The command writes into the
[themes folder](../reference/theme-files.md#where-caret-finds-theme-files) only when
`--out` points there:

```sh
caret convert-theme dracula.json --out ~/.config/caret/themes/dracula-custom.json
```

The input may contain comments and trailing commas (JSONC). The command maps:

- [`syntax`](../reference/theme-files.md#syntax): every role, required and optional,
    from the theme's token rules, as VS Code would color each scope. A token no rule
    colors takes the theme's `editor.foreground`, or VS Code's default for its `type` when
    it sets none, with a `syntax:` note. A `tokenColors` rule with no `scope` is ignored,
    as VS Code does.
- `scheme`: from the theme's `type`. `dark` and `hcDark` (high contrast) become `dark`;
    `light` and `hcLight` become `light`.
- [`palette`](../reference/theme-files.md#palette): the required colors, a best-effort
    pick from the theme's `colors`. A color with no clear source, missing or translucent,
    takes caret's own color for the scheme and is printed as a `palette.<key>:` note. The
    optional hues are left out, so caret derives them.
- `id` and `label`: from the theme's `name`, or the file name when it has none. An `id`
    that matches a built-in theme gets `-custom` appended, with a note.

Notes go to stderr as `caret convert-theme: <note>` and leave the exit code 0. The command
prints the reason, exits 1, and writes nothing when the theme:

- uses `include`;
- has a `tokenColors` that names a `.tmTheme` file;
- has no recognized `type`;
- can't be mapped for another reason, which it names.

Treat the output as a starting point: check the noted colors and tweak what you like.

## Get editor support

Set `$schema` to
`https://raw.githubusercontent.com/macintacos/caret/HEAD/docs/theme.schema.json`, as the
[example](../reference/theme-files.md#example) does. An editor that understands JSON
Schema, such as VS Code, then completes field names and flags invalid values as you type.

## Add the theme to caret

Save the file in the themes folder, `~/.config/caret/themes` (or
`$XDG_CONFIG_HOME/caret/themes` when that is set), then reload the review page. The theme
appears in the theme picker for its scheme in **Settings → Appearance**. Each file that
didn't load is listed there with its errors, under the theme pickers.

## Upload a theme

Click **Upload theme file…** in **Settings → Appearance**. caret checks the file against
the same
[rules as the themes folder](../reference/theme-files.md#where-caret-finds-theme-files)
and saves it into the themes folder as `<id>.json`, named from its `id`, never from the
uploaded file's name. A file that fails shows its errors, and caret saves nothing. caret
rejects the `id` of a built-in theme.

Uploading an `id` that another file already declares replaces that theme: caret writes
`<id>.json` and removes the other files. If caret can't remove one of those other files,
it still saves the upload and names the file it left; caret loads neither until you delete
that file.

caret refuses the upload when `<id>.json` already holds a theme with a different `id` that
caret loads. If caret skips that file, because its `id` is built in or another file
declares it too, the upload replaces it.

## Remove a theme

Delete its file from the themes folder. There is no delete control.
