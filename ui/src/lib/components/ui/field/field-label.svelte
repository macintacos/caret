<script lang="ts">
	import { Label } from "$lib/components/ui/label/index.js";
	import { cn } from "$lib/utils.js";
	import type { ComponentProps } from "svelte";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: ComponentProps<typeof Label> = $props();
</script>

<Label
	bind:ref
	data-slot="field-label"
	class={cn(
		// The `has-data-[state=checked]:` utilities belong to the registry's
		// checkbox-card pattern, where the control is a DESCENDANT of the label.
		// caret renders it as a sibling (SettingsDialog.svelte, inside `Field`
		// beside `FieldContent`), so a `:has()` descendant variant cannot match
		// here either way — EXC-1117 corrected the spelling only, since
		// restructuring caret's Field is a separate change (was `has-data-checked:`,
		// which compiled to a presence selector bits-ui never stamps).
		"gap-2 leading-snug group-data-[disabled=true]/field:opacity-50 has-data-[state=checked]:border-primary/30 has-data-[state=checked]:bg-primary/5 has-[>[data-slot=field]]:rounded-lg has-[>[data-slot=field]]:border *:data-[slot=field]:p-2.5 dark:has-data-[state=checked]:border-primary/20 dark:has-data-[state=checked]:bg-primary/10 group/field-label peer/field-label flex w-fit leading-snug",
		"has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</Label>
