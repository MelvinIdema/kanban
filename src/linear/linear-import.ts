// Imports Linear issues as linked backlog tasks. Shared by the web UI (tRPC) and
// the CLI so both go through the same mutateWorkspaceState + addTaskToColumn path.
import type { RuntimeBoardData, RuntimeLinearImportIssuesResponse } from "../core/api-contract";
import { addTaskToColumn, type RuntimeCreateTaskInput, resolveTaskBaseRef } from "../core/task-board-mutations";
import { mutateWorkspaceState } from "../state/workspace-state";
import { fetchLinearCustomerOpenIssues, fetchLinearIssueDetail, type LinearIssueDetail } from "./linear-api";
import { readLinkedLinearCustomer } from "./linear-customer-link";

export function buildLinearIssueTaskInput(issue: LinearIssueDetail, baseRef: string): RuntimeCreateTaskInput {
	const description = issue.description?.trim();
	return {
		title: issue.title,
		prompt: [issue.title, description, `Linear issue: ${issue.identifier} ${issue.url}`].filter(Boolean).join("\n\n"),
		baseRef,
		linearIssue: { id: issue.id, identifier: issue.identifier, url: issue.url },
	};
}

/** Adds issues to the top of backlog in the given order, skipping issues already linked on the board. */
export function addLinearIssuesToBoard(
	board: RuntimeBoardData,
	issues: LinearIssueDetail[],
	baseRef: string,
	randomUuid: () => string,
): { board: RuntimeBoardData; importedCount: number } {
	const linkedIssueIds = new Set(
		board.columns.flatMap((column) =>
			column.cards.flatMap((card) => (card.linearIssue ? [card.linearIssue.id] : [])),
		),
	);
	const newIssues = issues.filter(
		(issue, index) => !linkedIssueIds.has(issue.id) && issues.findIndex((other) => other.id === issue.id) === index,
	);
	// addTaskToColumn prepends, so add in reverse to keep the requested order on top.
	let nextBoard = board;
	for (const issue of [...newIssues].reverse()) {
		nextBoard = addTaskToColumn(nextBoard, "backlog", buildLinearIssueTaskInput(issue, baseRef), randomUuid).board;
	}
	return { board: nextBoard, importedCount: newIssues.length };
}

/** issueIds may be Linear UUIDs or identifiers like "ENG-123". */
export async function importLinearIssuesIntoWorkspace(
	workspacePath: string,
	issueIds: string[],
): Promise<LinearWorkspaceImportResult> {
	const issues = await Promise.all(issueIds.map((issueId) => fetchLinearIssueDetail(issueId.trim())));
	return await addLinearIssuesToWorkspace(workspacePath, issues);
}

/** Imports every Backlog/Todo issue requested by the project's linked Linear customer. */
export async function syncLinkedLinearCustomerIssues(workspacePath: string): Promise<LinearWorkspaceImportResult> {
	const customer = await readLinkedLinearCustomer(workspacePath);
	if (!customer) {
		throw new Error("This project is not linked to a Linear customer.");
	}
	return await addLinearIssuesToWorkspace(workspacePath, await fetchLinearCustomerOpenIssues(customer.id));
}

type LinearWorkspaceImportResult = RuntimeLinearImportIssuesResponse & { saved: boolean };

async function addLinearIssuesToWorkspace(
	workspacePath: string,
	issues: LinearIssueDetail[],
): Promise<LinearWorkspaceImportResult> {
	const response = await mutateWorkspaceState(workspacePath, (state) => {
		const baseRef = resolveTaskBaseRef(state);
		if (!baseRef) {
			throw new Error("Could not determine task base branch for this workspace.");
		}
		const result = addLinearIssuesToBoard(state.board, issues, baseRef, () => globalThis.crypto.randomUUID());
		return {
			board: result.board,
			value: { importedCount: result.importedCount, skippedCount: issues.length - result.importedCount },
			save: result.importedCount > 0,
		};
	});
	return { ...response.value, saved: response.saved };
}
