// Lifecycle controller for a @pierre/diffs view instance. One controller
// backs one mounted component: it creates the instance on first sync, applies
// option changes via setOptions (full replacement — the previous options are
// spread in so untouched keys survive) plus a repaint, applies annotation
// changes via setLineAnnotations plus a repaint, and recreates the instance
// only when the content identity (contentKey) changes. The instance factory
// is injected: components supply the real File/FileDiff constructors, tests a
// recording fake.

import { ensureCoreStyles } from "./coreStyles.ts";

/** The slice of a @pierre/diffs File/FileDiff instance the controller uses.
 * The real classes satisfy it structurally. */
export interface DiffViewInstance<TOptions, TAnnotation, TContent> {
  render(
    props: TContent & { fileContainer: HTMLElement; lineAnnotations?: TAnnotation[] },
  ): boolean;
  rerender(): void;
  setOptions(options: TOptions): void;
  setLineAnnotations(annotations: TAnnotation[]): void;
  /** Clears the render cache and re-renders, forcing a fresh tokenization pass.
   * The real File/FileDiff expose this as their theme-change hook; caret reuses
   * it to re-highlight after attaching fenced-code grammars. Optional so a test
   * fake can omit it. */
  onThemeChange?(): void;
  cleanUp(): void;
}

export interface DiffViewLifecycleDeps<TOptions, TAnnotation, TContent> {
  /** Creates a fresh library instance with the given options. */
  create(options: TOptions): DiffViewInstance<TOptions, TAnnotation, TContent>;
}

export interface DiffViewSyncProps<TOptions, TAnnotation, TContent> {
  /** Identity of the rendered content (e.g. review id + version pair).
   * Changing it is the only thing that recreates the instance. */
  contentKey: string;
  container: HTMLElement;
  content: TContent;
  options: TOptions;
  annotations?: TAnnotation[];
}

export interface DiffViewLifecycle<TOptions, TAnnotation, TContent> {
  /** Reconciles the instance with the given props. Change detection is by
   * reference, matching how Svelte's $derived memoizes the inputs. The
   * container must be stable for the lifecycle's lifetime — recreation is
   * keyed solely by contentKey (the components bind one div per mount). */
  sync(props: DiffViewSyncProps<TOptions, TAnnotation, TContent>): void;
  /** Forces a fresh tokenization pass on the current instance (no-op before the
   * first sync). Used after fenced-code grammars are attached to the shared
   * highlighter so already-rendered fences re-highlight. A plain rerender reuses
   * the cached tokens, so this clears the render cache first. */
  rehighlight(): void;
  /** Tears the instance down. Idempotent. */
  destroy(): void;
}

export function createDiffViewLifecycle<TOptions extends object, TAnnotation, TContent>(
  deps: DiffViewLifecycleDeps<TOptions, TAnnotation, TContent>,
): DiffViewLifecycle<TOptions, TAnnotation, TContent> {
  let instance: DiffViewInstance<TOptions, TAnnotation, TContent> | undefined;
  let contentKey: string | undefined;
  // What the instance currently holds, so option updates can spread it.
  let libOptions: TOptions | undefined;
  // Last-synced references for change detection.
  let lastOptions: TOptions | undefined;
  let lastAnnotations: TAnnotation[] | undefined;

  return {
    sync(props) {
      if (instance == null || props.contentKey !== contentKey) {
        instance?.cleanUp();
        // cleanUp leaves the old header/pre/style nodes in the container's
        // shadow root (it only detaches the instance's managers); clear them
        // so the fresh instance doesn't render alongside stale content.
        props.container.shadowRoot?.replaceChildren();
        instance = deps.create(props.options);
        instance.render({
          ...props.content,
          fileContainer: props.container,
          lineAnnotations: props.annotations,
        });
        // render() attaches the shadow root and emits the theme + content nodes,
        // but in container-managed mode the library leaves the structural grid
        // stylesheet to the container. Adopt it now (idempotent; the shared
        // sheet outlives the replaceChildren above).
        if (props.container.shadowRoot) ensureCoreStyles(props.container.shadowRoot);
        libOptions = props.options;
      } else {
        let dirty = false;
        if (props.options !== lastOptions) {
          libOptions = { ...libOptions, ...props.options };
          instance.setOptions(libOptions);
          dirty = true;
        }
        if (props.annotations !== lastAnnotations) {
          instance.setLineAnnotations(props.annotations ?? []);
          dirty = true;
        }
        if (dirty) instance.rerender();
      }
      contentKey = props.contentKey;
      lastOptions = props.options;
      lastAnnotations = props.annotations;
    },
    rehighlight() {
      instance?.onThemeChange?.();
    },
    destroy() {
      instance?.cleanUp();
      instance = undefined;
      contentKey = undefined;
      libOptions = undefined;
      lastOptions = undefined;
      lastAnnotations = undefined;
    },
  };
}
