import { renderMarkdown } from "$lib/markdown.ts";

// The sanitizer's output, tightened for a surface that renders GitHub-authored text:
// media makes the browser call out to its host, so only images GitHub itself serves
// survive — caret's update check already talks to GitHub — and an in-tab link would
// navigate the review away. The sanitizer already drops `srcset`.
export function releaseHtml(body: string): string {
  const template = document.createElement("template");
  template.innerHTML = renderMarkdown(body);
  for (const media of template.content.querySelectorAll("video, audio")) media.remove();
  for (const img of template.content.querySelectorAll("img")) {
    if (!isGitHubHosted(img.getAttribute("src") ?? "")) {
      img.remove();
      continue;
    }
    img.setAttribute("referrerpolicy", "no-referrer");
    img.setAttribute("loading", "lazy");
  }
  for (const a of template.content.querySelectorAll("a")) {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noreferrer");
  }
  return template.innerHTML;
}

function isGitHubHosted(src: string): boolean {
  if (!URL.canParse(src)) return false;
  const { protocol, hostname } = new URL(src);
  return (
    protocol === "https:" &&
    (hostname === "github.com" || hostname.endsWith(".githubusercontent.com"))
  );
}
