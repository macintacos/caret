<script lang="ts">
	import type { HTMLInputAttributes, HTMLInputTypeAttribute } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";

	type InputType = Exclude<HTMLInputTypeAttribute, "file">;

	type Props = WithElementRef<
		Omit<HTMLInputAttributes, "type"> &
			({ type: "file"; files?: FileList } | { type?: InputType; files?: undefined })
	>;

	let {
		ref = $bindable(null),
		value = $bindable(),
		type,
		files = $bindable(),
		class: className,
		"data-slot": dataSlot = "input",
		...restProps
	}: Props = $props();
</script>

{#if type === "file"}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(
			// Layout + sizing
			"flex h-9 w-full min-w-0",
			// Shape + surface
			"rounded-md border border-input bg-transparent dark:bg-input/30 shadow-xs",
			// Spacing + type
			"px-3 pt-1.5 text-sm font-medium",
			// Selection + placeholder
			"selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground ring-offset-background",
			// Motion
			"transition-[color,box-shadow] outline-none",
			// Disabled
			"disabled:cursor-not-allowed disabled:opacity-50",
			// Focus ring
			"focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
			// Invalid state
			"aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
			className
		)}
		type="file"
		bind:files
		bind:value
		{...restProps}
	/>
{:else}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(
			// Layout + sizing
			"flex h-9 w-full min-w-0",
			// Shape + surface
			"rounded-md border border-input bg-background dark:bg-input/30 shadow-xs",
			// Spacing + type
			"px-3 py-1 text-base md:text-sm",
			// Selection + placeholder
			"selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground ring-offset-background",
			// Motion
			"transition-[color,box-shadow] outline-none",
			// Disabled
			"disabled:cursor-not-allowed disabled:opacity-50",
			// Focus ring
			"focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
			// Invalid state
			"aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
			className
		)}
		{type}
		bind:value
		{...restProps}
	/>
{/if}
