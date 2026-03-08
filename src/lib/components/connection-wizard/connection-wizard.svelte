<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogFooter,
		DialogHeader,
		DialogTitle,
	} from "$lib/components/ui/dialog";
	import { Button } from "$lib/components/ui/button";
	import { m } from "$lib/paraglide/messages.js";
	import { useDatabase } from "$lib/hooks/database.svelte.js";
	import { connectionWizardStore } from "$lib/stores/connection-wizard.svelte.js";
	import { onboardingStore } from "$lib/stores/onboarding.svelte.js";
	import { toast } from "svelte-sonner";
	import { extractErrorMessage } from "$lib/errors/types";
	import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";

	import WizardStepMethod from "./wizard-step-method.svelte";
	import WizardStepDetails from "./wizard-step-details.svelte";

	const db = useDatabase();
	const wizard = connectionWizardStore;

	// Auto-connect when all credentials are loaded in reconnect mode
	$effect(() => {
		if (wizard.shouldAutoConnect && wizard.credentialsLoaded && !wizard.isConnecting) {
			// Reset the flag immediately to prevent re-triggering
			wizard.shouldAutoConnect = false;

			if (wizard.hasAllCredentials) {
				// All credentials available - attempt auto-connect
				handleAutoConnect();
			} else {
				// Missing credentials - show the dialog
				wizard.showDialog();
			}
		}
	});

	const handleAutoConnect = async () => {
		wizard.isConnecting = true;
		try {
			const connectionData = wizard.getConnectionData();
			if (wizard.reconnectingConnectionId) {
				await db.connections.reconnect(wizard.reconnectingConnectionId, connectionData);
			}
			// Mark onboarding as complete
			onboardingStore.completeWizard();
			// Show toast and close wizard without showing the dialog
			if (db.state.activeSchema.length === 0) {
				toast.warning(m.wizard_connect_empty());
			} else {
				toast.success(m.wizard_connect_success());
			}
			wizard.close();
		} catch (error) {
			// Auto-connect failed, show the dialog so user can fix the issue
			wizard.isConnecting = false;
			wizard.setError(extractErrorMessage(error));
			wizard.showDialog();
		}
	};

	const handleTestConnection = async () => {
		wizard.clearError();

		if (!wizard.formData.name.trim()) {
			wizard.setError(m.connection_dialog_error_name_required());
			return;
		}

		if (wizard.formData.type !== "sqlite" && !wizard.formData.host.trim()) {
			wizard.setError(m.connection_dialog_error_host_required());
			return;
		}

		if (!wizard.formData.databaseName.trim()) {
			wizard.setError(m.connection_dialog_error_database_required());
			return;
		}

		wizard.isTesting = true;
		try {
			const connectionData = wizard.getConnectionData();
			await db.connections.test(connectionData);
			toast.success(m.wizard_test_success());
		} catch (error) {
			wizard.setError(extractErrorMessage(error));
		} finally {
			wizard.isTesting = false;
		}
	};

	const handleConnect = async () => {
		wizard.clearError();

		// Validate required fields
		if (!wizard.formData.name.trim()) {
			wizard.setError(m.connection_dialog_error_name_required());
			return;
		}

		if (wizard.formData.type !== "sqlite" && !wizard.formData.host.trim()) {
			wizard.setError(m.connection_dialog_error_host_required());
			return;
		}

		if (!wizard.formData.databaseName.trim()) {
			wizard.setError(m.connection_dialog_error_database_required());
			return;
		}

		wizard.isConnecting = true;
		try {
			const connectionData = wizard.getConnectionData();

			if (wizard.mode === "edit" && wizard.reconnectingConnectionId) {
				// Edit mode - just update settings without reconnecting
				await db.connections.update(wizard.reconnectingConnectionId, connectionData);
				toast.success(m.wizard_edit_success());
			} else if (wizard.reconnectingConnectionId) {
				await db.connections.reconnect(wizard.reconnectingConnectionId, connectionData);
				// Mark onboarding as complete
				onboardingStore.completeWizard();
				// Show toast
				if (db.state.activeSchema.length === 0) {
					toast.warning(m.wizard_connect_empty());
				} else {
					toast.success(m.wizard_connect_success());
				}
			} else {
				await db.connections.add(connectionData);
				// Mark onboarding as complete
				onboardingStore.completeWizard();
				// Show toast
				if (db.state.activeSchema.length === 0) {
					toast.warning(m.wizard_connect_empty());
				} else {
					toast.success(m.wizard_connect_success());
				}
			}

			wizard.close();
		} catch (error) {
			wizard.setError(extractErrorMessage(error));
		} finally {
			wizard.isConnecting = false;
		}
	};

	const handleParse = (connStr: string): boolean => {
		return wizard.parseConnectionString(connStr);
	};

	const isReconnecting = $derived(wizard.reconnectingConnectionId !== null && wizard.mode !== "edit");
	const isEditing = $derived(wizard.mode === "edit");

	const showBack = $derived(
		wizard.currentStep === "details" && !isReconnecting && !isEditing,
	);
</script>

<Dialog bind:open={wizard.isOpen}>
	<DialogContent class="max-w-lg max-h-[90vh] overflow-y-auto">
		<DialogHeader>
			<DialogTitle>
				{#if isEditing}
					{m.wizard_dialog_title_edit()}
				{:else if isReconnecting}
					{m.connection_dialog_title_reconnect()}
				{:else}
					{m.wizard_dialog_title()}
				{/if}
			</DialogTitle>
		</DialogHeader>

		<!-- Step Content -->
		<div class="min-h-[300px]">
			{#if wizard.currentStep === "method"}
				<WizardStepMethod
					bind:formData={wizard.formData}
					onParse={handleParse}
					onSelectType={(type) => wizard.selectDatabaseType(type)}
					onContinue={() => wizard.nextStep()}
					error={wizard.connectionError}
				/>
			{:else if wizard.currentStep === "details"}
				<WizardStepDetails
					bind:formData={wizard.formData}
					selectedDbType={wizard.selectedDbType}
					{isReconnecting}
					{isEditing}
					isTesting={wizard.isTesting}
					onTest={handleTestConnection}
					error={wizard.connectionError}
				/>
			{/if}
		</div>

		<!-- Footer (step 2 only) -->
		{#if wizard.currentStep === "details"}
			<DialogFooter class="flex-row justify-between gap-2">
				<div>
					{#if showBack}
						<Button
							variant="ghost"
							onclick={() => wizard.prevStep()}
							disabled={wizard.isConnecting}
						>
							<ArrowLeftIcon class="size-4 me-2" />
							{m.wizard_back()}
						</Button>
					{/if}
				</div>

				<div class="flex gap-2">
					<Button
						onclick={handleConnect}
						disabled={!wizard.canProceed || wizard.isConnecting || wizard.isTesting}
					>
						{#if wizard.isConnecting}
							{m.connection_dialog_button_connecting()}
						{:else if isEditing}
							{m.wizard_save()}
						{:else if isReconnecting}
							{m.connection_dialog_button_reconnect()}
						{:else}
							{m.wizard_connect()}
						{/if}
					</Button>
				</div>
			</DialogFooter>
		{/if}
	</DialogContent>
</Dialog>
