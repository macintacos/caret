/** Simulate a user picking `file` in a file input: happy-dom has no file chooser, so
 * set the input's `files` and fire the bubbling `change` a real pick would. */
export function pickFile(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
