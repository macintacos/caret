// `caret convert-theme`: turn a VS Code color theme into a caret theme file. Writes to
// stdout unless `--out` names a path — it never writes into the themes folder on its own.

import { mkdir, stat } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";

import { writeFileAtomic } from "@/lib/atomic-write.ts";
import { errorMessage } from "@/lib/types.ts";
import { BUILTIN_THEME_IDS } from "@/theme/builtin-ids.ts";
import { themeFileFromVsCode } from "@/theme/vscode-import.ts";

const say = (line: string) => process.stderr.write(`caret convert-theme: ${line}\n`);

/** Converts `file`, reporting every failure itself: an error escaping to `runProgram`
 * would hit the review path's fatal-deny handler. */
export async function runConvertTheme(
  file: string,
  opts: { out?: string | undefined },
): Promise<void> {
  try {
    process.exitCode = await convert(file, opts.out);
  } catch (err) {
    say(errorMessage(err));
    process.exitCode = 1;
  }
}

async function convert(file: string, out: string | undefined): Promise<0 | 1> {
  let input: string;
  try {
    input = await Bun.file(file).text();
  } catch (err) {
    say(`can't read ${file}: ${errorMessage(err)}`);
    return 1;
  }
  const result = themeFileFromVsCode(input, basename(file, extname(file)), BUILTIN_THEME_IDS);
  if (!result.ok) {
    for (const error of result.errors) say(error);
    return 1;
  }
  for (const note of result.notes) say(note);
  if (out === undefined) {
    process.stdout.write(result.text);
  } else {
    if ((await stat(out).catch(() => undefined))?.isDirectory()) {
      say(`can't write ${out}: it is a directory; name the theme file`);
      return 1;
    }
    try {
      await mkdir(dirname(out), { recursive: true });
      await writeFileAtomic(out, result.text, { mode: 0o644 });
    } catch (err) {
      say(`can't write ${out}: ${errorMessage(err)}`);
      return 1;
    }
  }
  return 0;
}
