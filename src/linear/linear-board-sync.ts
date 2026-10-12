// Pushes column moves of Linear-linked cards to the linked issue's workflow state.
// Runs after every board write (UI saves and server-side mutations alike) and
// never blocks or fails the write: Linear errors are logged and dropped.
import type { RuntimeBoardColumnId, RuntimeBoardData, RuntimeLinearIssueRef } from "../core/api-contract";
import {
	fetchLinearIssueWorkflow,
	type LinearWorkflowState,
	readLinearApiKey,
	updateLinearIssueState,
} from "./linear-api";

const pendingSyncs = new Set<Promise<void>>();

interface LinkedCardLocation {
	columnId: RuntimeBoardColumnId;
	linearIssue: RuntimeLinearIssueRef;
}

function collectLinkedCards(board: RuntimeBoardData): Map<string, LinkedCardLocation> {
	const linked = new Map<string, LinkedCardLocation>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			if (card.linearIssue) {
				linked.set(card.id, { columnId: column.id, linearIssue: card.linearIssue });
			}
		}
	}
	return linked;
}

/** Cards that exist on both boards and changed column. New cards (imports) are not moves. */
export function findLinkedCardMoves(
	previousBoard: RuntimeBoardData,
	nextBoard: RuntimeBoardData,
): Array<{ linearIssue: RuntimeLinearIssueRef; toColumnId: RuntimeBoardColumnId }> {
	const previous = collectLinkedCards(previousBoard);
	const moves: Array<{ linearIssue: RuntimeLinearIssueRef; toColumnId: RuntimeBoardColumnId }> = [];
	for (const [cardId, next] of collectLinkedCards(nextBoard)) {
		const before = previous.get(cardId);
		if (before && before.columnId !== next.columnId) {
			moves.push({ linearIssue: next.linearIssue, toColumnId: next.columnId });
		}
	}
	return moves;
}

/**
 * Picks the team's workflow state for a column by Linear's state type, lowest
 * position first. Review has no state type of its own, so it only maps when the
 * team has a started state named like "In Review"; otherwise the issue stays put.
 */
export function pickLinearStateForColumn(
	columnId: RuntimeBoardColumnId,
	states: LinearWorkflowState[],
): LinearWorkflowState | null {
	const sorted = [...states].sort((left, right) => left.position - right.position);
	const firstOfType = (type: string) => sorted.find((state) => state.type === type) ?? null;
	switch (columnId) {
		case "backlog":
			return firstOfType("unstarted");
		case "in_progress":
			return sorted.find((state) => state.type === "started" && !/review/i.test(state.name)) ?? null;
		case "review":
			return sorted.find((state) => state.type === "started" && /review/i.test(state.name)) ?? null;
		case "trash":
			return firstOfType("completed");
	}
}

async function syncIssueToColumn(linearIssue: RuntimeLinearIssueRef, columnId: RuntimeBoardColumnId): Promise<void> {
	const workflow = await fetchLinearIssueWorkflow(linearIssue.id);
	const target = pickLinearStateForColumn(columnId, workflow.team.states.nodes);
	if (!target || target.id === workflow.state.id) {
		return;
	}
	await updateLinearIssueState(linearIssue.id, target.id);
}

export function syncLinearIssuesForBoardChange(previousBoard: RuntimeBoardData, nextBoard: RuntimeBoardData): void {
	const moves = findLinkedCardMoves(previousBoard, nextBoard);
	if (moves.length === 0) {
		return;
	}
	const sync = (async () => {
		if (!(await readLinearApiKey())) {
			return;
		}
		await Promise.all(
			moves.map(({ linearIssue, toColumnId }) =>
				syncIssueToColumn(linearIssue, toColumnId).catch((error: unknown) => {
					const message = error instanceof Error ? error.message : String(error);
					process.stderr.write(`[kanban] Could not sync ${linearIssue.identifier} to Linear: ${message}\n`);
				}),
			),
		);
	})();
	pendingSyncs.add(sync);
	void sync.finally(() => pendingSyncs.delete(sync));
}

/** Lets short-lived CLI commands finish in-flight Linear updates before exiting. */
export async function waitForPendingLinearSyncs(): Promise<void> {
	await Promise.allSettled([...pendingSyncs]);
}
