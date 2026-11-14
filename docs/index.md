# caret

*Audience: people using caret with Claude Code, OpenCode, or pi.*

caret replaces your agent host's plan-approval prompt with a review page in your browser.
Your [agent host](reference/glossary.md#agent-host) is the coding tool caret plugs into:
Claude Code, OpenCode, or pi. You read the plan on the
[review page](reference/glossary.md#review-page), comment on the lines that matter, then
approve it or request changes. caret sends your feedback back to the agent. One
[background service](reference/glossary.md#background-service) serves all your sessions,
so you review several plans from one browser tab.

![caret's review page: a plan with two inline comments, the file it cites open in a file preview, and the comment list open](assets/caret-review-ui-light.png#only-light)
![caret's review page: a plan with two inline comments, the file it cites open in a file preview, and the comment list open](assets/caret-review-ui-dark.png#only-dark)

[Watch a short demo video](https://youtu.be/zesv5AunUW4).

On Claude Code, start with [Review your first plan](tutorial/first-plan.md), which
installs caret as its first step. On OpenCode or pi, start with
[Install caret](how-to/install.md).

The tabs across the top sort the rest of the site:

- **Tutorial**: learn caret by using it, start to finish.
- **How-to guides**: the steps for one task.
- **Reference**: commands, settings, and files to look up.
- **Explanation**: why caret works the way it does.
- **Changelog**: what changed in each release.

To work on caret itself, see
[CONTRIBUTING.md](https://github.com/macintacos/caret/blob/main/CONTRIBUTING.md).
