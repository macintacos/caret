<script lang="ts">
	import { Command as CommandPrimitive, useId } from "bits-ui";
	import { cn } from "$lib/utils.js";

	// `headingClass` is caret's addition to the registry source, and a re-sync drops
	// it silently. The stock heading is styled by the literal classes below and
	// exposes no override, so a caret surface wanting its own label vocabulary — the
	// ToC popup's breadcrumb header wears the shared `.eyebrow` atom — has nowhere
	// to put it. Merged rather than replacing, so the stock look stays the default.
	// `PlanToc.test.ts` reds when a re-sync reverts it.
	let {
		ref = $bindable(null),
		class: className,
		children,
		heading,
		headingClass,
		value,
		...restProps
	}: CommandPrimitive.GroupProps & {
		heading?: string;
		headingClass?: string;
	} = $props();
</script>

<CommandPrimitive.Group
	bind:ref
	data-slot="command-group"
	class={cn("overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground", className)}
	value={value ?? heading ?? `----${useId()}`}
	{...restProps}
>
	{#if heading}
		<CommandPrimitive.GroupHeading class={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", headingClass)}>
			{heading}
		</CommandPrimitive.GroupHeading>
	{/if}
	<CommandPrimitive.GroupItems {children} />
</CommandPrimitive.Group>
