<script module lang="ts">
    import { getContext } from "svelte";

    export interface DnDContext {
        current: string | null;
        /** Signal a drop at the given screen coordinates */
        drop: (x: number, y: number) => void;
        /** Callback set by the canvas to handle drops */
        onDrop: ((x: number, y: number) => void) | null;
    }

    export const useDnD = () => {
        return getContext("dnd") as DnDContext;
    };
</script>

<script lang="ts">
    import { onDestroy, setContext, type Snippet } from "svelte";

    let { children }: { children: Snippet } = $props();

    let dndType = $state<string | null>(null);
    let dropHandler: ((x: number, y: number) => void) | null = null;

    const ctx: DnDContext = {
        set current(value: string | null) {
            dndType = value;
        },
        get current() {
            return dndType;
        },
        drop(x: number, y: number) {
            if (dropHandler) dropHandler(x, y);
            dndType = null;
        },
        set onDrop(handler: ((x: number, y: number) => void) | null) {
            dropHandler = handler;
        },
        get onDrop() {
            return dropHandler;
        },
    };

    setContext("dnd", ctx);

    onDestroy(() => {
        dndType = null;
        dropHandler = null;
    });
</script>

{@render children()}
