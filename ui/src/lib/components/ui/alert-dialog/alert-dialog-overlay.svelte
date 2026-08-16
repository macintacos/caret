<script lang="ts">
	import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: AlertDialogPrimitive.OverlayProps = $props();
</script>

<AlertDialogPrimitive.Overlay
	bind:ref
	data-slot="alert-dialog-overlay"
	class={cn(
		// Position only. The scrim and its blur come from styles/shadcn-bridge.css §
		// Modal choreography (EXC-892), shared with the dialog overlay — a guard and a
		// settings pane dim the app the same way or the app has two backdrop languages.
		"fixed inset-0 z-50",
		// Open / close animation. No duration here and none wanted: this surface used to
		// inherit tw-animate-css's implicit .15s, and now takes caret's enter/exit pair
		// from the bridge like the other three.
		"data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
		className
	)}
	{...restProps}
/>

