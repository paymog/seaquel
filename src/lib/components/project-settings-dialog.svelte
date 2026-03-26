<script lang="ts">
	import { useDatabase } from "$lib/hooks/database.svelte.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import SyncButton from "$lib/components/shared-queries/sync-button.svelte";
	import SyncStatusBadge from "$lib/components/shared-queries/sync-status-badge.svelte";
	import { FolderOpenIcon, Trash2Icon, LinkIcon } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { errorToast } from "$lib/utils/toast";
	import { m } from "$lib/paraglide/messages.js";
	import { isTauri } from "$lib/utils/environment";
	import { DEFAULT_PROJECT_ID } from "$lib/types";
	import { buildDeepLinkUrl } from "$lib/services/deep-link";

	interface Props {
		projectId: string;
		open: boolean;
	}

	let { projectId, open = $bindable() }: Props = $props();

	const db = useDatabase();

	const project = $derived(db.state.projects.find((p) => p.id === projectId));
	const repo = $derived.by(() => {
		if (!project?.gitRepoPath) return null;
		return db.state.sharedRepos.find((r) => r.path === project.gitRepoPath) ?? null;
	});
	const syncState = $derived(repo ? (db.state.syncStateByRepo[repo.id] ?? null) : null);
	const sharedProject = $derived.by(() => {
		if (!repo) return null;
		const projects = db.state.sharedProjectsByRepo[repo.id] ?? [];
		return projects.find((p) => p.name === project?.name) ?? projects[0] ?? null;
	});

	const copyProjectLink = async () => {
		if (!repo?.remoteUrl || !sharedProject) return;
		const filePath = `.seaquel/projects/${sharedProject.dirName}`;
		const url = buildDeepLinkUrl(repo.remoteUrl, repo.branch, filePath);
		await navigator.clipboard.writeText(url);
		toast.success("Link copied to clipboard");
	};

	let nameInput = $state("");
	let descriptionInput = $state("");
	let remoteUrlInput = $state("");
	let pendingGitRepoPath = $state<string | undefined>(undefined);
	let hasPendingGitChange = $state(false);

	// Reset form when dialog opens or project changes
	$effect(() => {
		if (open && project) {
			nameInput = project.name;
			descriptionInput = project.description ?? "";
			remoteUrlInput = repo?.remoteUrl ?? "";
			pendingGitRepoPath = project.gitRepoPath;
			hasPendingGitChange = false;
		}
	});

	const handleSave = async () => {
		if (!nameInput.trim()) return;

		// Capture pending values before any awaits — the $effect may reset
		// these reactive variables between await points when project state updates
		const savePendingGitRepoPath = pendingGitRepoPath;
		const saveHasPendingGitChange = hasPendingGitChange;
		const saveRemoteUrlInput = remoteUrlInput.trim();

		await db.projects.update(projectId, {
			name: nameInput.trim(),
			description: descriptionInput.trim() || undefined,
		});

		// Apply git repo path change if modified
		if (saveHasPendingGitChange) {
			await db.projects.setGitRepoPath(projectId, savePendingGitRepoPath);

			// Import shared connections from the linked git repo (if any)
			if (savePendingGitRepoPath) {
				await db.projects.importSharedConnections(projectId);
			}
		}

		// Close dialog immediately — git sync work continues in the background
		open = false;

		// Update remote URL if changed (check against the now-potentially-updated repo)
		const updatedRepo = savePendingGitRepoPath
			? db.state.sharedRepos.find((r) => r.path === savePendingGitRepoPath)
			: repo;
		if (updatedRepo && saveRemoteUrlInput !== (updatedRepo.remoteUrl ?? "")) {
			try {
				await db.sharedRepos.setRemoteUrl(updatedRepo.id, saveRemoteUrlInput);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				errorToast(`Failed to set remote URL: ${message}`);
			}
		}

	};

	const handleSelectFolder = async () => {
		if (!isTauri()) return;
		try {
			const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
			const selected = await openDialog({
				directory: true,
				multiple: false,
				title: m.project_settings_select_folder(),
			});
			if (selected) {
				pendingGitRepoPath = selected as string;
				hasPendingGitChange = true;

				// Auto-detect remote URL from the selected git repo
				try {
					const { getRemoteUrl } = await import("$lib/services/git");
					const detectedUrl = await getRemoteUrl(selected as string);
					if (detectedUrl) {
						remoteUrlInput = detectedUrl;
					}
				} catch {
					// No remote configured — that's fine
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errorToast(`Failed to select folder: ${message}`);
		}
	};

	const handleInitRepo = async () => {
		if (!isTauri()) return;
		try {
			const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
			const selected = await openDialog({
				directory: true,
				multiple: false,
				title: m.project_settings_init_repo(),
			});
			if (selected) {
				// Initialize a new git repo at the selected path
				const { initRepo, getRemoteUrl } = await import("$lib/services/git");
				await initRepo(selected as string);
				pendingGitRepoPath = selected as string;
				hasPendingGitChange = true;
				toast.success(m.shared_repo_initialized({ name: project?.name ?? "" }));

				// Auto-detect remote URL from the initialized repo
				try {
					const detectedUrl = await getRemoteUrl(selected as string);
					if (detectedUrl) {
						remoteUrlInput = detectedUrl;
					}
				} catch {
					// No remote configured — that's fine
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errorToast(`Failed to initialize repository: ${message}`);
		}
	};

	const handleRemoveGitDir = () => {
		pendingGitRepoPath = undefined;
		hasPendingGitChange = true;
	};

	const canDelete = $derived(projectId !== DEFAULT_PROJECT_ID && db.state.projects.length > 1);
	let showDeleteConfirm = $state(false);

	const handleDeleteProject = async () => {
		await db.projects.remove(projectId);
		showDeleteConfirm = false;
		open = false;
	};
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{m.project_settings_title()}</Dialog.Title>
		</Dialog.Header>

		<div class="space-y-6 py-4 min-w-0">
			<!-- General Section -->
			<div class="space-y-3">
				<h3 class="text-sm font-medium">{m.project_settings_general()}</h3>
				<div class="space-y-2">
					<label for="project-name" class="text-xs text-muted-foreground">
						{m.project_name_placeholder()}
					</label>
					<Input
						id="project-name"
						bind:value={nameInput}
						placeholder={m.project_name_placeholder()}
						onkeydown={(e) => e.key === "Enter" && handleSave()}
					/>
				</div>
				<div class="space-y-2">
					<label for="project-description" class="text-xs text-muted-foreground">
						Description
					</label>
					<textarea
						id="project-description"
						bind:value={descriptionInput}
						placeholder="Optional project description"
						class="w-full px-3 py-2 border rounded-md bg-background text-sm min-h-16 resize-y"
					></textarea>
				</div>
			</div>

			<!-- Team Sharing Section -->
			{#if isTauri()}
				<div class="border-t pt-4 space-y-3">
					<h3 class="text-sm font-medium">{m.project_settings_sharing()}</h3>
					<p class="text-xs text-muted-foreground">
						{m.project_settings_sharing_description()}
					</p>

					{#if !pendingGitRepoPath}
						<!-- No git dir configured -->
						<div class="rounded-md border border-dashed p-4 text-center space-y-3">
							<p class="text-xs text-muted-foreground">
								{m.project_settings_no_git()}
							</p>
							<div class="flex gap-2 justify-center">
								<Button variant="outline" size="sm" onclick={handleSelectFolder}>
									<FolderOpenIcon class="size-3 me-1" />
									{m.project_settings_select_folder()}
								</Button>
								<Button variant="outline" size="sm" onclick={handleInitRepo}>
									{m.project_settings_init_repo()}
								</Button>
							</div>
						</div>
					{:else}
						<!-- Git dir configured -->
						<div class="space-y-3">
							<!-- Path display -->
							<div class="space-y-1">
								<span class="text-xs text-muted-foreground">{m.project_settings_git_path()}</span>
								<div class="flex items-center gap-2 min-w-0">
									<code class="flex-1 min-w-0 text-xs bg-muted px-2 py-1.5 rounded truncate block">
										{pendingGitRepoPath}
									</code>
									<Button variant="ghost" size="sm" class="shrink-0" onclick={handleSelectFolder}>
										Change
									</Button>
								</div>
							</div>

							<!-- Remote URL -->
							<div class="space-y-1">
								<span class="text-xs text-muted-foreground">
									{m.project_settings_remote_url()}
								</span>
								<Input
									bind:value={remoteUrlInput}
									placeholder={m.shared_git_remote_url()}
									class="text-sm"
								/>
							</div>

							<!-- Sync controls -->
							{#if repo}
								<div class="flex items-center gap-2 min-w-0 flex-wrap">
									<SyncButton repoId={repo.id} size="sm" />
									<SyncStatusBadge
										status={repo.syncStatus}
										{syncState}
									/>
									{#if repo.lastSyncAt}
										<span class="text-xs text-muted-foreground ms-auto truncate">
											Last synced {repo.lastSyncAt.toLocaleString()}
										</span>
									{/if}
								</div>
							{/if}

							<!-- Share & Remove -->
							<div class="flex items-center gap-3">
								{#if repo?.remoteUrl && sharedProject}
									<button
										class="text-xs text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1"
										onclick={copyProjectLink}
									>
										<LinkIcon class="size-3" />
										{m.share_project()}
									</button>
								{/if}
								<button
									class="text-xs text-muted-foreground hover:text-destructive cursor-pointer flex items-center gap-1"
									onclick={handleRemoveGitDir}
								>
									<Trash2Icon class="size-3" />
									{m.project_settings_remove_git()}
								</button>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<Dialog.Footer class="gap-2">
			{#if canDelete}
				<Button
					variant="ghost"
					class="me-auto text-destructive hover:text-destructive"
					onclick={() => { showDeleteConfirm = true; }}
				>
					<Trash2Icon class="size-4 me-1" />
					{m.project_delete()}
				</Button>
			{/if}
			<Button variant="outline" onclick={() => { open = false; }}>
				{m.header_button_cancel()}
			</Button>
			<Button onclick={handleSave} disabled={!nameInput.trim()}>
				{m.common_save()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Delete Project Confirmation -->
<Dialog.Root bind:open={showDeleteConfirm}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.project_delete_dialog_title()}</Dialog.Title>
			<Dialog.Description>
				{m.project_delete_dialog_description({ name: project?.name ?? "" })}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="gap-2">
			<Button variant="outline" onclick={() => showDeleteConfirm = false}>
				{m.header_button_cancel()}
			</Button>
			<Button variant="destructive" onclick={handleDeleteProject}>
				{m.project_delete_confirm()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
