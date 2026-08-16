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
		// Position only. The scrim and its blur moved to styles/shadcn-bridge.css §
		// Modal choreography (EXC-892), declared there once for BOTH overlays — this
		// one used to be a 10% black with a blur while the alert-dialog's was a 50%
		// black without one, which is the drift a shared rule exists to end.
		"fixed inset-0 isolate z-50",
		// Open / close animation. Keyed on data-[state=…], the attribute bits-ui
		// actually emits — a bare `data-open:` compiles to an [data-open] presence
		// selector that nothing ever sets, so the whole set is dead (EXC-891). The
		// alert-dialog copies already spell it this way; a `shadcn add --overwrite`
		// would restore the broken form.
		// The stock `duration-100` is gone with the scrim, and for the same reason:
		// the backdrop deepens on the panel's clock, not its own.
		"data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
		className
	)}
	{...restProps}
/>
