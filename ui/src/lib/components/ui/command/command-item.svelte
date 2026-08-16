<script lang="ts">
	import { Command as CommandPrimitive } from "bits-ui";
	// caret vendors icons rather than depending on @lucide/svelte (EXC-754 parent
	// decision). The stock `@lucide/svelte/icons/check` import is replaced by the
	// vendored glyph through Icon.svelte. Icon takes no `class`, so the indicator's
	// visibility rules move onto a wrapper <span> — the same shape
	// dropdown-menu-sub-trigger.svelte uses.
	import Icon from "@/components/Icon.svelte";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: CommandPrimitive.ItemProps = $props();
</script>

<CommandPrimitive.Item
	bind:ref
	data-slot="command-item"
	class={cn(
		// Layout + resting look — matched to dropdown-menu-item so a Command row and a
		// DropdownMenu row read as the same control, cursor included (stock ships
		// rounded-sm + cursor-default, plus an `in-data-[slot=dialog-content]:rounded-lg!`
		// override that this radius makes dead)
		"group/command-item relative flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-hidden select-none",
		// Highlighted (hover / keyboard) row. Stock reaches for bg-muted (caret's
		// recessed --paper-sunk); caret's menu highlight is the neutral --chip-hover
		// wash behind bg-accent, so a highlighted row matches the topbar's button hover
		// app-wide (doc/agents/shadcn-rules.md § Menu highlight vs. selection). The
		// sibling command-link-item.svelte already spells it this way upstream.
		// The glyph rule is a DESCENDANT selector: stock's `*:[svg]` compiles to a direct
		// child, which Icon.svelte's wrapper <span> puts out of reach (dropdown-menu-item
		// uses the descendant form for the same reason).
		"data-selected:bg-accent data-selected:text-accent-foreground data-selected:[&_svg]:text-accent-foreground",
		// Disabled row. bits-ui emits `data-disabled=""` (presence), so stock's
		// `data-[disabled=true]` never matches — dropdown-menu-item already spells it bare.
		"data-disabled:pointer-events-none data-disabled:opacity-50",
		// Leading icon: sizing, no pointer capture
		"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<span
		class="cn-command-item-indicator ml-auto flex items-center opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100"
	>
		<Icon name="check" size={16} />
	</span>
</CommandPrimitive.Item>
