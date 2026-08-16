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
		// Position only. No scrim or blur utility here: stock ships `bg-black/50`, and
		// caret declares one scrim and one blur for BOTH modal overlays in
		// styles/shadcn-bridge.css § Modal choreography (EXC-892).
		"fixed inset-0 z-50",
		// Open / close animation. Stock ships no duration here at all, which leaves the
		// surface on tw-animate-css's implicit .15s; the bridge gives it caret's
		// enter/exit pair like the other three.
		"data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
		className
	)}
	{...restProps}
/>

