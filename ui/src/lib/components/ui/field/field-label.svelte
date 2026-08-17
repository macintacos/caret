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
		// The `has-data-[state=checked]:` utilities are inert in caret and stay that
		// way deliberately. They belong to the registry's checkbox-card pattern, where
		// the control is a DESCENDANT of the label; caret's settings rows put the
		// control beside FieldContent (SettingsDialog.svelte), so the `:has()` never
		// matches. The spelling is kept correct — `data-state` is what bits-ui's
		// Checkbox and Switch stamp — so the day a caret surface does nest a control
		// they work without a second investigation (EXC-1117). Restructuring Field is
		// its own change.
		"gap-2 leading-snug group-data-[disabled=true]/field:opacity-50 has-data-[state=checked]:border-primary/30 has-data-[state=checked]:bg-primary/5 has-[>[data-slot=field]]:rounded-lg has-[>[data-slot=field]]:border *:data-[slot=field]:p-2.5 dark:has-data-[state=checked]:border-primary/20 dark:has-data-[state=checked]:bg-primary/10 group/field-label peer/field-label flex w-fit leading-snug",
		"has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</Label>
