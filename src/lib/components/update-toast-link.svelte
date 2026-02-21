<script lang="ts">
    let { version }: { version: string } = $props();
</script>

<button
    class="underline opacity-70 hover:opacity-100 cursor-pointer text-xs"
    onclick={async () => {
        const { openPath } = await import("$lib/api/tauri");
        openPath(`https://seaquel.app/changelog/${version}`);
    }}
>
    What's new?
</button>
