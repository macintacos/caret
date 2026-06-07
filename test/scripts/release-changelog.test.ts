import { expect, test } from "bun:test";
import {
  composeReleaseTitle,
  findSection,
  findTopReleasedVersion,
  parseHeading,
} from "../../scripts/release/changelog.ts";

const CHANGELOG = `# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] - 2026-06-02 - The Foundations Release

### Added

- Release automation script and \`/release-caret\` skill.

### Changed

- Platform sans-serif across the UI.

## [0.0.1] - 2026-05-01 - The Genesis Release

### Added

- Initial commit.

[Unreleased]: https://github.com/macintacos/caret/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/macintacos/caret/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/macintacos/caret/releases/tag/v0.0.1
`;

test("parseHeading reads version, date, and themed title", () => {
  expect(parseHeading("## [0.1.0] - 2026-06-02 - The Foundations Release")).toEqual({
    version: "0.1.0",
    date: "2026-06-02",
    title: "The Foundations Release",
  });
});

test("parseHeading handles a one-character theme without dropping the heading", () => {
  expect(parseHeading("## [0.1.0] - 2026-06-02 - X")).toEqual({
    version: "0.1.0",
    date: "2026-06-02",
    title: "X",
  });
});

test("parseHeading returns a null title when there is no theme", () => {
  expect(parseHeading("## [0.1.0] - 2026-06-02")).toEqual({
    version: "0.1.0",
    date: "2026-06-02",
    title: null,
  });
});

test("parseHeading returns null for the Unreleased heading and non-headings", () => {
  expect(parseHeading("## [Unreleased]")).toBeNull();
  expect(parseHeading("### Added")).toBeNull();
  expect(parseHeading("- a bullet")).toBeNull();
});

test("findSection returns the heading and notes for a version, stopping at the next section", () => {
  const section = findSection(CHANGELOG, "0.1.0");
  expect(section?.heading.title).toBe("The Foundations Release");
  expect(section?.notes).toContain("Release automation script");
  expect(section?.notes).toContain("Platform sans-serif");
  expect(section?.notes).not.toContain("0.0.1");
  expect(section?.notes).not.toContain("Initial commit");
});

test("findSection notes for the last release exclude the link-reference footers", () => {
  const section = findSection(CHANGELOG, "0.0.1");
  expect(section?.notes).toContain("Initial commit");
  expect(section?.notes).not.toContain("compare");
  expect(section?.notes).not.toContain("https://");
});

test("findSection returns null for an absent version", () => {
  expect(findSection(CHANGELOG, "9.9.9")).toBeNull();
});

test("findTopReleasedVersion returns the first released version below Unreleased", () => {
  expect(findTopReleasedVersion(CHANGELOG)).toBe("0.1.0");
});

test("composeReleaseTitle builds the themed asset title", () => {
  expect(composeReleaseTitle("0.1.0", "The Foundations Release")).toBe(
    "v0.1.0 - The Foundations Release",
  );
  expect(composeReleaseTitle("0.1.0", null)).toBe("v0.1.0");
});
