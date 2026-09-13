<!--
caret demo template. Fill the four slots, then present everything after this comment as
the plan. Never include this comment.

Look at the working directory in exactly two ways: one non-recursive listing of its top
level, and one read of the first 40 lines of the file you pick for the first file slot. No
recursion, no content search, no other reads, no edits.

Skip hidden entries (a leading `.`), dependency and build output (`node_modules`, `vendor`,
`dist`, `build`, `out`, `target`, `coverage`, `__pycache__`), lockfiles, and binaries.
Prefer entries a reader recognises: a README, a manifest, a source entry point.

Replace every occurrence of each placeholder:

- `path/to/folder/` → a top-level directory, keeping the trailing `/`
- `path/to/first-file` → a top-level file
- `path/to/second-file` → a different top-level file
- `path/to/cited-file:1` → `<first file>:<n>`, where `n` is a non-blank line among the
  lines you read

Each slot falls back on its own: a slot with no usable candidate keeps its placeholder and
the others still fill. With nothing usable at all, present the plan unchanged.
-->

# Add a getting-started guide

> **Try it:** comment on any line, or request changes. The agent revises the plan and
> caret keeps the revision as a new version.

## Context

Someone new to this repository meets its top level first: `path/to/first-file`,
`path/to/second-file`, and the `path/to/folder/` folder. Nothing tells them which to open
first or how the pieces relate, so the first hour goes to guessing.

A short guide fixes that without touching any code. It walks the top level in the order a
newcomer needs it, and quotes real lines so every pointer lands on something that exists,
starting from `path/to/cited-file:1`.

## Approach

Write one page, `GETTING_STARTED.md`, and link it from the top of
[the first file](path/to/first-file). Shape it the way
[Diátaxis](https://diataxis.fr/tutorials/) describes a tutorial: a single path from a
fresh clone to one small, visible result.

### What the guide covers

Three stops, in the order a newcomer needs them:

| Stop | Path                  | What the reader learns        |
| ---- | --------------------- | ----------------------------- |
| 1    | `path/to/first-file`  | What the project is for       |
| 2    | `path/to/second-file` | How it is configured or built |
| 3    | `path/to/folder/`     | Where the real work lives     |

### How it is written

#### Tone

Second person, present tense, one idea per paragraph. Every path the guide names is one a
reader can open.

#### Commands

Each stop ends in a command the reader can run and check:

```sh
git clone <this-repo> && cd <this-repo>
ls path/to/folder/
```

## Steps

1. Draft `GETTING_STARTED.md` around the three stops in the table.
2. Link it from near the top of `path/to/first-file`.
3. Ask one newcomer to follow it cold, and note where they stall.
4. Revisit the guide whenever the top level gains or loses an entry.

## Verification

- Every path in the guide opens to the file or folder it names.
- A newcomer reaches the visible result in under fifteen minutes.

## Risks

A guide drifts as the code moves. Keeping it to the top level, and citing lines instead of
copying them, keeps the drift small and easy to spot.
