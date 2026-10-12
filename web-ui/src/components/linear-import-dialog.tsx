import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check, Import, Search } from "lucide-react";
import { type FormEvent, type ReactElement, useEffect, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { LinearCustomerSection } from "@/components/linear-customer-section";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useLinearImport } from "@/hooks/use-linear-import";

const INPUT_CLASS_NAME =
	"w-full h-8 px-2.5 text-[13px] rounded-md border border-border bg-surface-2 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent";

export function LinearImportDialog({
	open,
	onOpenChange,
	workspaceId,
	linkedIssueIds,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspaceId: string | null;
	linkedIssueIds: ReadonlySet<string>;
}): ReactElement {
	const { hasApiKey, issues, isLoading, error, search, notStartedOnly, setNotStartedOnly, saveApiKey, importIssues } =
		useLinearImport(open, workspaceId);
	const [query, setQuery] = useState("");
	const [apiKeyInput, setApiKeyInput] = useState("");
	const [isEditingKey, setIsEditingKey] = useState(false);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [isImporting, setIsImporting] = useState(false);

	useEffect(() => {
		if (open) {
			setQuery("");
			setApiKeyInput("");
			setIsEditingKey(false);
			setSelectedIds(new Set());
		}
	}, [open]);

	const showKeyForm = hasApiKey === false || isEditingKey;

	const handleSaveKey = async (event: FormEvent) => {
		event.preventDefault();
		if (!apiKeyInput.trim()) {
			return;
		}
		await saveApiKey(apiKeyInput);
		setApiKeyInput("");
		setIsEditingKey(false);
	};

	const handleSearch = (event: FormEvent) => {
		event.preventDefault();
		void search(query);
	};

	const toggleIssue = (issueId: string, checked: boolean) => {
		setSelectedIds((current) => {
			const next = new Set(current);
			if (checked) {
				next.add(issueId);
			} else {
				next.delete(issueId);
			}
			return next;
		});
	};

	const handleImport = async () => {
		// Keep the list order so the first issue in the list ends up on top of backlog.
		const issueIds = issues.filter((issue) => selectedIds.has(issue.id)).map((issue) => issue.id);
		setIsImporting(true);
		try {
			const result = await importIssues(issueIds);
			const skipped = result.skippedCount > 0 ? ` (${result.skippedCount} already on the board)` : "";
			showAppToast({
				intent: "success",
				message: `Imported ${result.importedCount} Linear issue${result.importedCount === 1 ? "" : "s"}${skipped}.`,
			});
			onOpenChange(false);
		} catch (importError) {
			showAppToast({
				intent: "danger",
				message: importError instanceof Error ? importError.message : String(importError),
			});
		} finally {
			setIsImporting(false);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => !isImporting && onOpenChange(nextOpen)}
			contentClassName="max-w-xl"
		>
			<DialogHeader title="Import from Linear" icon={<Import size={16} />} />
			<DialogBody className="flex flex-col gap-3">
				{hasApiKey === null && !error ? (
					<div className="flex justify-center py-6">
						<Spinner size={16} />
					</div>
				) : null}

				{showKeyForm ? (
					<form onSubmit={(event) => void handleSaveKey(event)} className="flex flex-col gap-2">
						<label htmlFor="linear-api-key-input" className="text-[13px] text-text-secondary">
							Paste a Linear personal API key (Linear → Settings → Security &amp; access → Personal API keys). It
							is stored only on this machine.
						</label>
						<div className="flex gap-2">
							<input
								id="linear-api-key-input"
								type="password"
								autoComplete="off"
								value={apiKeyInput}
								onChange={(event) => setApiKeyInput(event.target.value)}
								placeholder="lin_api_..."
								className={INPUT_CLASS_NAME}
							/>
							<Button type="submit" variant="primary" className="shrink-0" disabled={!apiKeyInput.trim()}>
								Save key
							</Button>
						</div>
					</form>
				) : null}

				{hasApiKey && !isEditingKey ? (
					<>
						<LinearCustomerSection enabled={open} workspaceId={workspaceId} />
						<form onSubmit={handleSearch} className="flex gap-2">
							<input
								type="text"
								aria-label="Search Linear issues"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="Search, or paste IDs like ENG-123 ENG-124. Empty shows your assigned issues."
								className={INPUT_CLASS_NAME}
							/>
							<Button type="submit" icon={<Search size={14} />} className="shrink-0" disabled={isLoading}>
								Search
							</Button>
						</form>
						<label
							htmlFor="linear-not-started-only"
							className="flex cursor-pointer items-center gap-2 text-[13px] text-text-secondary"
						>
							<RadixCheckbox.Root
								id="linear-not-started-only"
								checked={notStartedOnly}
								onCheckedChange={(checked) => setNotStartedOnly(checked === true)}
								className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border bg-surface-2 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
							>
								<RadixCheckbox.Indicator>
									<Check size={12} className="text-white" />
								</RadixCheckbox.Indicator>
							</RadixCheckbox.Root>
							Only Backlog &amp; Todo
						</label>
						<div className="max-h-[45vh] min-h-24 overflow-y-auto rounded-md border border-border bg-surface-0">
							{isLoading ? (
								<div className="flex justify-center py-6">
									<Spinner size={16} />
								</div>
							) : issues.length === 0 ? (
								<p className="m-0 py-6 text-center text-[13px] text-text-tertiary">No issues found.</p>
							) : (
								issues.map((issue) => {
									const isLinked = linkedIssueIds.has(issue.id);
									const checkboxId = `linear-issue-${issue.id}`;
									return (
										<label
											key={issue.id}
											htmlFor={checkboxId}
											className="flex cursor-pointer items-center gap-2 border-b border-border px-2.5 py-2 text-[13px] last:border-b-0 hover:bg-surface-2 has-[:disabled]:cursor-default has-[:disabled]:opacity-50"
										>
											<RadixCheckbox.Root
												id={checkboxId}
												checked={isLinked || selectedIds.has(issue.id)}
												disabled={isLinked}
												onCheckedChange={(checked) => toggleIssue(issue.id, checked === true)}
												className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border bg-surface-2 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
											>
												<RadixCheckbox.Indicator>
													<Check size={12} className="text-white" />
												</RadixCheckbox.Indicator>
											</RadixCheckbox.Root>
											<span className="shrink-0 font-mono text-text-secondary">{issue.identifier}</span>
											<span className="min-w-0 flex-1 truncate text-text-primary">{issue.title}</span>
											<span className="shrink-0 text-xs text-text-tertiary">
												{isLinked ? "On board" : issue.stateName}
											</span>
										</label>
									);
								})
							)}
						</div>
					</>
				) : null}

				{error ? <p className="m-0 text-[13px] text-status-red">{error}</p> : null}
			</DialogBody>
			<DialogFooter>
				{hasApiKey && !isEditingKey ? (
					<Button variant="ghost" className="mr-auto" onClick={() => setIsEditingKey(true)}>
						Change API key
					</Button>
				) : null}
				<Button variant="default" onClick={() => onOpenChange(false)} disabled={isImporting}>
					Cancel
				</Button>
				<Button
					variant="primary"
					onClick={() => void handleImport()}
					disabled={!hasApiKey || isEditingKey || selectedIds.size === 0 || isImporting}
				>
					{isImporting ? <Spinner size={14} /> : null}
					Import {selectedIds.size > 0 ? selectedIds.size : ""}
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
