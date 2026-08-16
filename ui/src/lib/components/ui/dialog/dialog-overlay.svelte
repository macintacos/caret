<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: DialogPrimitive.OverlayProps = $props();
</script>

<DialogPrimitive.Overlay
	bind:ref
	data-slot="dialog-overlay"
	class={cn(
		// Position only. No scrim or blur utility here: stock ships `bg-black/50`, and
		// caret declares one scrim and one blur for BOTH modal overlays in
		// styles/shadcn-bridge.css § Modal choreography (EXC-892), so a dismissible
		// pane and a decision guard dim the app the same way.
		"fixed inset-0 isolate z-50",
		// Open / close animation. Keyed on data-[state=…], the attribute bits-ui
		// actually emits — a bare `data-open:` compiles to an [data-open] presence
		// selector that nothing ever sets, so the whole set is dead (EXC-891). The
		// alert-dialog copies already spell it this way; a `shadcn add --overwrite`
		// would restore the broken form.
		// No duration utility either, and for the same reason: the backdrop rides the
		// panel's clock so the two read as one gesture.
		"data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
		className
	)}
	{...restProps}
/>
