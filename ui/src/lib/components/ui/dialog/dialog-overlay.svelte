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
		// Position + surface
		"fixed inset-0 isolate z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs",
		// Open / close animation. Keyed on data-[state=…], the attribute bits-ui
		// actually emits — a bare `data-open:` compiles to an [data-open] presence
		// selector that nothing ever sets, so the whole set is dead (EXC-891). The
		// alert-dialog copies already spell it this way; a `shadcn add --overwrite`
		// would restore the broken form.
		"data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-100",
		className
	)}
	{...restProps}
/>
