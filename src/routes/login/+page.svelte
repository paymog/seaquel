<script lang="ts">
	import { onMount } from "svelte";
	import { login } from "$lib/auth/api";
	import { isAuthenticated } from "$lib/auth/token";
	import { isServer } from "$lib/utils/environment";
	import { goto } from "$app/navigation";

	let password = $state("");
	let error = $state("");
	let loading = $state(false);

	onMount(() => {
		// If already authenticated, bounce to the app.
		if (isAuthenticated()) {
			goto("/");
		}
	});

	async function handleSubmit(e: Event) {
		e.preventDefault();
		loading = true;
		error = "";
		const ok = await login(password);
		loading = false;
		if (ok) {
			goto("/");
		} else {
			error = "Invalid password";
		}
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-background">
	<div class="w-full max-w-sm space-y-6 p-8">
		<div class="text-center">
			<h1 class="text-2xl font-bold text-foreground">Seaquel</h1>
			<p class="mt-1 text-sm text-muted-foreground">Enter your password to continue</p>
		</div>

		<form onsubmit={handleSubmit} class="space-y-4">
			<div>
				<input
					type="password"
					bind:value={password}
					placeholder="Password"
					class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
					disabled={loading}
					autofocus
				/>
			</div>

			{#if error}
				<p class="text-sm text-destructive">{error}</p>
			{/if}

			<button
				type="submit"
				class="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				disabled={loading || !password}
			>
				{loading ? "Signing in…" : "Sign in"}
			</button>
		</form>
	</div>
</div>
