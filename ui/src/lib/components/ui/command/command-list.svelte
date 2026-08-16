<script lang="ts">
	import { Command as CommandPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	// `children` is destructured out of restProps rather than forwarded through the
	// spread: the rows go inside the Viewport below, not straight into the List.
	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: CommandPrimitive.ListProps = $props();
</script>

<CommandPrimitive.List
	bind:ref
	data-slot="command-list"
	class={cn("no-scrollbar max-h-72 scroll-py-1 outline-none overflow-x-hidden overflow-y-auto", className)}
	{...restProps}
>
	<!-- The Viewport is caret's addition to the registry source, and it is load-bearing
	     rather than structural padding (EXC-1096). bits-ui derives the command input's
	     `aria-controls` AND `aria-activedescendant` from `CommandRootState.viewportNode`,
	     which is set by exactly one thing: the `attachRef` inside `CommandViewportState`.
	     Without a Viewport mounted, `viewportNode` stays null and BOTH attributes compute
	     to undefined — so every Command in the app renders a combobox that names neither
	     the list it controls nor the option the selection is on, and nothing is narrated
	     as its rows narrow. `CommandViewportState.create()` reads `CommandListContext`, so
	     it has to be a descendant of this List and nowhere else.
	     `role="none"` is the other half. The List itself carries `role="listbox"`, and a
	     listbox may own options and groups but not a generic element — an untyped wrapper
	     here would take ownership of the rows away from the listbox, which is the exact
	     defect PlanToc.svelte's `aria-hidden` context rows already avoid. The role
	     survives `mergeProps(restProps, state.props)` because `CommandViewportState.props`
	     defines no `role` of its own to override it with.
	     Two things to know before reading those attributes back. bits-ui's own List wraps
	     its children in `{#key search === ""}`, so this viewport is destroyed and rebuilt
	     — `viewportNode` briefly null, then a NEW id — every time a query crosses between
	     empty and non-empty; poll them rather than sampling once. And `aria-controls`
	     names this viewport rather than the listbox around it, which is bits-ui's choice
	     and not one caret can make from here: closing it would mean teaching
	     `CommandListState` to publish its own node upstream. `aria-activedescendant` is
	     the attribute actually carrying the narration, and it resolves correctly.
	     A re-sync from the registry (`shadcn-svelte add command`) will drop both, silently
	     — `shadcn-command-popover.test.ts` is what reds when it does. -->
	<CommandPrimitive.Viewport data-slot="command-viewport" role="none">
		{@render children?.()}
	</CommandPrimitive.Viewport>
</CommandPrimitive.List>
