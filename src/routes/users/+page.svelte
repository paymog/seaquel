<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import type { User } from "$lib/auth/users";
	import { listUsers, createUser, updateUser, deleteUser } from "$lib/auth/users";
	import { getAuthUser } from "$lib/auth/token";
	import { isServer } from "$lib/utils/environment";
	import { roleStore } from "$lib/auth/role.svelte";
	import { errorToast } from "$lib/utils/toast";
	import { toast } from "svelte-sonner";
	import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
	import SearchIcon from "@lucide/svelte/icons/search";
	import PlusIcon from "@lucide/svelte/icons/plus";
	import Trash2Icon from "@lucide/svelte/icons/trash-2";
	import UsersIcon from "@lucide/svelte/icons/users";

	const ROLES = [
		{ value: "viewer", label: "Viewer (read-only)" },
		{ value: "editor", label: "Editor (read + write)" },
		{ value: "admin", label: "Admin (full access)" },
	];

	let users = $state<User[]>([]);
	let loading = $state(true);
	let query = $state("");

	// Create form
	let newUsername = $state("");
	let newPassword = $state("");
	let newRole = $state("viewer");
	let creating = $state(false);
	let showCreate = $state(false);

	const currentUser = $derived(getAuthUser());
	const filtered = $derived(
		query.trim()
			? users.filter((u) => u.username.toLowerCase().includes(query.trim().toLowerCase()))
			: users,
	);

	onMount(() => {
		roleStore.init();
		// Guard: only available in server mode + admin
		if (!isServer() || !roleStore.isAdmin) {
			goto(resolve("/manage"), { replaceState: true });
			return;
		}
		loadUsers();
	});

	async function loadUsers() {
		loading = true;
		try {
			users = await listUsers();
		} catch {
			errorToast("Failed to load users");
		}
		loading = false;
	}

	async function handleCreate() {
		if (!newUsername || !newPassword) return;
		creating = true;
		try {
			await createUser(newUsername, newPassword, newRole);
			toast.success(`Created user "${newUsername}"`);
			newUsername = "";
			newPassword = "";
			newRole = "viewer";
			showCreate = false;
			await loadUsers();
		} catch (e) {
			errorToast(e instanceof Error ? e.message : "Failed to create user");
		}
		creating = false;
	}

	async function handleRoleChange(user: User, role: string) {
		try {
			await updateUser(user.username, { role });
			toast.success(`Updated ${user.username} to ${role}`);
			await loadUsers();
		} catch {
			errorToast("Failed to update user");
		}
	}

	async function handleDelete(user: User) {
		try {
			await deleteUser(user.username);
			toast.success(`Deleted user "${user.username}"`);
			await loadUsers();
		} catch {
			errorToast("Failed to delete user");
		}
	}
</script>

<div class="flex h-full flex-col bg-background text-foreground">
	<header class="flex items-center gap-2 border-b px-4 py-2.5 shrink-0">
		<Button
			variant="ghost"
			size="icon"
			class="size-7"
			title="Back"
			aria-label="Back"
			onclick={() => goto(resolve("/manage"))}
		>
			<ArrowLeftIcon class="size-4" />
		</Button>
		<UsersIcon class="size-4 text-muted-foreground" />
		<h1 class="text-sm font-semibold">Users</h1>
		<span class="text-xs text-muted-foreground hidden sm:inline">Create, edit, and remove user accounts</span>

		<div class="flex-1"></div>

		<div class="relative w-56">
			<SearchIcon class="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
			<Input
				bind:value={query}
				placeholder="Search users…"
				class="h-8 pl-7 text-xs"
			/>
		</div>

		<Button size="sm" class="h-8" onclick={() => (showCreate = !showCreate)}>
			<PlusIcon class="size-3.5" />
			Add user
		</Button>
	</header>

	{#if showCreate}
		<div class="border-b bg-muted/30 px-4 py-3 shrink-0">
			<div class="mx-auto max-w-3xl rounded-md border bg-background p-3 space-y-3">
				<p class="text-sm font-medium">Add user</p>
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
					<div>
						<Label for="new-username" class="text-xs">Username</Label>
						<Input id="new-username" bind:value={newUsername} placeholder="username" class="h-8" />
					</div>
					<div>
						<Label for="new-password" class="text-xs">Password</Label>
						<Input id="new-password" type="password" bind:value={newPassword} placeholder="••••••" class="h-8" />
					</div>
					<div>
						<Label for="new-role" class="text-xs">Role</Label>
						<Select.Root type="single" bind:value={newRole}>
							<Select.Trigger id="new-role" class="h-8 text-xs">
								{ROLES.find((r) => r.value === newRole)?.label}
							</Select.Trigger>
							<Select.Content>
								{#each ROLES as role}
									<Select.Item value={role.value} label={role.label}>{role.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
				</div>
				<div class="flex justify-end gap-2">
					<Button variant="outline" size="sm" onclick={() => (showCreate = false)}>Cancel</Button>
					<Button
						size="sm"
						onclick={handleCreate}
						disabled={creating || !newUsername || !newPassword}
					>
						{creating ? "Adding…" : "Add user"}
					</Button>
				</div>
			</div>
		</div>
	{/if}

	<div class="flex-1 overflow-auto min-h-0">
		<div class="mx-auto max-w-3xl px-4 py-4 space-y-1.5">
			{#if loading}
				<p class="text-sm text-muted-foreground text-center py-8">Loading…</p>
			{:else if filtered.length === 0}
				<p class="text-sm text-muted-foreground text-center py-8">
					{query ? "No matching users." : "No users."}
				</p>
			{:else}
				{#each filtered as user (user.username)}
					<div class="flex items-center justify-between rounded-md border px-3 py-2 bg-background">
						<div class="flex min-w-0 items-center gap-2">
							<span class="text-sm font-medium truncate">{user.username}</span>
							{#if user.username === currentUser}
								<span class="text-xs text-muted-foreground shrink-0">(you)</span>
							{/if}
						</div>
						<div class="flex items-center gap-2 shrink-0">
							<Select.Root type="single" value={user.role} onValueChange={(v) => v && handleRoleChange(user, v)}>
								<Select.Trigger class="h-7 w-36 text-xs">
									{ROLES.find((r) => r.value === user.role)?.label ?? user.role}
								</Select.Trigger>
								<Select.Content>
									{#each ROLES as role}
										<Select.Item value={role.value} label={role.label}>{role.label}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
							{#if user.username !== currentUser}
								<Button
									variant="ghost"
									size="sm"
									class="text-destructive hover:text-destructive h-7 px-2"
									title="Delete user"
									aria-label="Delete user"
									onclick={() => handleDelete(user)}
								>
									<Trash2Icon class="size-3.5" />
								</Button>
							{/if}
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>
