<script lang="ts">
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import type { User } from "$lib/auth/users";
	import { listUsers, createUser, updateUser, deleteUser } from "$lib/auth/users";
	import { getAuthUser } from "$lib/auth/token";
	import { errorToast } from "$lib/utils/toast";
	import { toast } from "svelte-sonner";

	type Props = { open?: boolean };
	let { open = $bindable(false) }: Props = $props();

	let users = $state<User[]>([]);
	let loading = $state(false);

	// Create form
	let newUsername = $state("");
	let newPassword = $state("");
	let newRole = $state("viewer");
	let creating = $state(false);

	const ROLES = [
		{ value: "viewer", label: "Viewer (read-only)" },
		{ value: "editor", label: "Editor (read + write)" },
		{ value: "admin", label: "Admin (full access)" },
	];

	const currentUser = $derived(getAuthUser());

	// Load users when dialog opens
	$effect(() => {
		if (open) loadUsers();
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

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>User Management</Dialog.Title>
			<Dialog.Description>Create, edit, and remove user accounts.</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4">
			<!-- Create new user -->
			<div class="rounded-md border p-3 space-y-3">
				<p class="text-sm font-medium">Add User</p>
				<div class="grid grid-cols-2 gap-2">
					<div>
						<Label for="new-username" class="text-xs">Username</Label>
						<Input id="new-username" bind:value={newUsername} placeholder="username" />
					</div>
					<div>
						<Label for="new-password" class="text-xs">Password</Label>
						<Input id="new-password" type="password" bind:value={newPassword} placeholder="••••••" />
					</div>
				</div>
				<div class="flex items-end gap-2">
					<div class="flex-1">
						<Label for="new-role" class="text-xs">Role</Label>
						<Select.Root type="single" bind:value={newRole}>
							<Select.Trigger id="new-role" class="h-8">{ROLES.find((r) => r.value === newRole)?.label}</Select.Trigger>
							<Select.Content>
								{#each ROLES as role}
									<Select.Item value={role.value} label={role.label}>{role.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<Button onclick={handleCreate} disabled={creating || !newUsername || !newPassword} size="sm">
						{creating ? "Adding…" : "Add"}
					</Button>
				</div>
			</div>

			<!-- User list -->
			<div class="space-y-1.5">
				{#if loading}
					<p class="text-sm text-muted-foreground text-center py-4">Loading…</p>
				{:else}
					{#each users as user (user.username)}
						<div class="flex items-center justify-between rounded-md border px-3 py-2">
							<div class="flex items-center gap-2">
								<span class="text-sm font-medium">{user.username}</span>
								{#if user.username === currentUser}
									<span class="text-xs text-muted-foreground">(you)</span>
								{/if}
							</div>
							<div class="flex items-center gap-2">
								<Select.Root type="single" value={user.role} onValueChange={(v) => v && handleRoleChange(user, v)}>
									<Select.Trigger class="h-7 w-32 text-xs">{ROLES.find((r) => r.value === user.role)?.label ?? user.role}</Select.Trigger>
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
										onclick={() => handleDelete(user)}
									>
										Delete
									</Button>
								{/if}
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
