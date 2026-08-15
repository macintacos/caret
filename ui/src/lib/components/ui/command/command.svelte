<script lang="ts">
	// The root radius is `rounded-xl` without stock's trailing `!`. A Command nested in
	// a host with its own radius — Popover.Content is rounded-lg — has to be able to
	// take that radius from `class`, and tailwind-merge inside cn() can only drop the
	// base utility when the base is overridable.
	import { Command as CommandPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	export type CommandRootApi = CommandPrimitive.Root;

	let {
		api = $bindable(null),
		ref = $bindable(null),
		value = $bindable(""),
		class: className,
		...restProps
	}: CommandPrimitive.RootProps & {
		api?: CommandRootApi | null;
	} = $props();
</script>

<CommandPrimitive.Root
	bind:this={api}
	bind:value
	bind:ref
	data-slot="command"
	class={cn("rounded-xl bg-popover p-1 text-popover-foreground flex size-full flex-col overflow-hidden", className)}
	{...restProps}
/>
