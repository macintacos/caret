<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import DialogPortal from "./dialog-portal.svelte";
	import type { Snippet } from "svelte";
	import * as Dialog from "./index.js";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import type { ComponentProps } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	// caret vendors icons rather than depending on @lucide/svelte (EXC-754 parent
	// decision). The stock component imported `@lucide/svelte/icons/x` here; the
	// close glyph is inlined below (the same Lucide "x" markup) so this vendored
	// tree stays self-contained and adds no icon runtime dependency.

	let {
		ref = $bindable(null),
		class: className,
		portalProps,
		children,
		showCloseButton = true,
		...restProps
	}: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DialogPortal>>;
		children: Snippet;
		showCloseButton?: boolean;
	} = $props();
</script>

<DialogPortal {...portalProps}>
	<Dialog.Overlay />
	<DialogPrimitive.Content
		bind:ref
		data-slot="dialog-content"
		class={cn(
			// Surface + ring
			"bg-popover text-popover-foreground ring-1 ring-foreground/10",
			// Position
			"fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
			// Box layout + sizing
			"grid w-full max-w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto gap-4 sm:max-w-sm",
			// Shape + spacing + type
			"rounded-xl p-4 text-sm outline-none",
			// Open / close animation. Keyed on data-[state=…], the attribute bits-ui
			// actually emits — a bare `data-open:` compiles to an [data-open] presence
			// selector that nothing ever sets, so the whole set is dead (EXC-891). The
			// alert-dialog copies already spell it this way; a `shadcn add --overwrite`
			// would restore the broken form.
			"data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-100",
			className
		)}
		{...restProps}
	>
		{@render children?.()}
		{#if showCloseButton}
			<DialogPrimitive.Close data-slot="dialog-close">
				{#snippet child({ props })}
					<Button variant="ghost" class="absolute top-2 right-2" size="icon-sm" {...props}>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="24"
							height="24"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M18 6 6 18" />
							<path d="m6 6 12 12" />
						</svg>
						<span class="sr-only">Close</span>
					</Button>
				{/snippet}
			</DialogPrimitive.Close>
		{/if}
	</DialogPrimitive.Content>
</DialogPortal>
