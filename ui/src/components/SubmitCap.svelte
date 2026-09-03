<script lang="ts">
  // The ⌘↵ cap worn by every control the submit chord fires — the comment
  // composer's Save/Comment, the Request Changes send, the approve/reject
  // confirm. Decorative: the control itself carries
  // aria-keyshortcuts={ariaKeyshortcutsFor("editor.submit")}, which is what a
  // screen reader announces.
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import Icon from "@/components/Icon.svelte";
</script>

<Kbd aria-hidden="true">
  <Icon name="command" size={12} /><Icon name="corner-down-left" size={12} />
</Kbd>
