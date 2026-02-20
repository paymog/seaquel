<script lang="ts">
    import { goto } from "$app/navigation";
    import { resolve } from "$app/paths";
    import { page } from "$app/state";
    import { onMount } from "svelte";

    onMount(() => {
        const mode = page.url.searchParams.get("mode");
        if (mode === "learn") {
            goto(resolve("/learn"), { replaceState: true });
        } else {
            goto(resolve("/manage"), { replaceState: true });
        }
    });
</script>
