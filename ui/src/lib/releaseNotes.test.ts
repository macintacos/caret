import "@ui/support/setup.ts";
import { describe, expect, test } from "bun:test";

import { releaseHtml } from "$lib/releaseNotes.ts";

function fragment(body: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = releaseHtml(body);
  return template.content;
}

const images = (body: string) => [...fragment(body).querySelectorAll("img")];

describe("releaseHtml images", () => {
  test.each([
    "https://github.com/macintacos/caret/releases/download/v1.5.0/approve-with-comments.png",
    "https://github.com/user-attachments/assets/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
    "https://private-user-images.githubusercontent.com/1/shot.png?jwt=abc",
    "https://user-images.githubusercontent.com/1/shot.png",
  ])("keeps a GitHub-hosted image: %s", (src) => {
    expect(images(`![shot](${src})`).map((img) => img.getAttribute("src"))).toEqual([src]);
  });

  test.each([
    "http://github.com/x.png",
    "//github.com/x.png",
    "data:image/png;base64,iVBORw0KGgo=",
    "/x.png",
    "./x.png",
    "x.png",
    "https://e.com/x.png",
    "https://github.com.evil.example/x.png",
    "https://evilgithubusercontent.com/x.png",
    "https://githubusercontent.com/x.png",
    "https://githubusercontent.com.evil.example/x.png",
    "https://github.com@evil.example/x.png",
    "https://evil.example/github.com/x.png",
  ])("strips an image hosted anywhere else: %s", (src) => {
    expect(images(`![shot](${src}) <img src="${src}">`).length).toBe(0);
  });

  test("a kept image loads lazily, sends no referrer, and keeps its alt", () => {
    const [img] = images("![The approve dialog](https://github.com/x.png)");
    expect(img?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("alt")).toBe("The approve dialog");
  });

  test("a kept image carries no srcset", () => {
    const [img] = images('<img src="https://github.com/x.png" srcset="https://e.com/x.png 2x">');
    expect(img?.hasAttribute("srcset")).toBe(false);
  });

  test("strips video and audio, even when GitHub hosts them", () => {
    const src = "https://github.com/user-attachments/assets/0f1e2d3c";
    const body = `<video src="${src}"></video> <audio src="${src}"></audio>`;
    expect(fragment(body).querySelector("video, audio") === null).toBe(true);
  });
});
