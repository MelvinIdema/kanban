import { describe, expect, it } from "vitest";

import type { RuntimeBoardData } from "../../../src/core/api-contract";
import { moveTaskToColumn } from "../../../src/core/task-board-mutations";
import type { LinearIssueDetail, LinearWorkflowState } from "../../../src/linear/linear-api";
import { findLinkedCardMoves, pickLinearStateForColumn } from "../../../src/linear/linear-board-sync";
import { addLinearIssuesToBoard } from "../../../src/linear/linear-import";

function createBoard(): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies: [],
	};
}

function issue(n: number): LinearIssueDetail {
	return {
		id: `issue-${n}`,
		identifier: `ENG-${n}`,
		title: `Issue ${n}`,
		url: `https://linear.app/x/issue/ENG-${n}`,
		description: n === 1 ? "Details" : null,
	};
}

let uuidCounter = 0;
const nextUuid = () => `${String(++uuidCounter).padStart(5, "0")}aaa`;

describe("addLinearIssuesToBoard", () => {
	it("adds linked tasks in request order and skips duplicates and already-linked issues", () => {
		const first = addLinearIssuesToBoard(createBoard(), [issue(1), issue(2), issue(1)], "main", nextUuid);
		expect(first.importedCount).toBe(2);
		const backlog = first.board.columns[0]?.cards ?? [];
		expect(backlog.map((card) => card.linearIssue?.identifier)).toEqual(["ENG-1", "ENG-2"]);
		expect(backlog[0]?.title).toBe("Issue 1");
		expect(backlog[0]?.prompt).toBe("Issue 1\n\nDetails\n\nLinear issue: ENG-1 https://linear.app/x/issue/ENG-1");

		const second = addLinearIssuesToBoard(first.board, [issue(2), issue(3)], "main", nextUuid);
		expect(second.importedCount).toBe(1);
		expect(second.board.columns[0]?.cards.map((card) => card.linearIssue?.identifier)).toEqual([
			"ENG-3",
			"ENG-1",
			"ENG-2",
		]);
	});
});

describe("findLinkedCardMoves", () => {
	it("reports column changes of linked cards only, not new cards", () => {
		const imported = addLinearIssuesToBoard(createBoard(), [issue(1)], "main", nextUuid).board;
		expect(findLinkedCardMoves(createBoard(), imported)).toEqual([]);

		const taskId = imported.columns[0]?.cards[0]?.id ?? "";
		const moved = moveTaskToColumn(imported, taskId, "in_progress").board;
		expect(findLinkedCardMoves(imported, moved)).toEqual([
			{ linearIssue: imported.columns[0]?.cards[0]?.linearIssue, toColumnId: "in_progress" },
		]);
	});
});

describe("pickLinearStateForColumn", () => {
	const states: LinearWorkflowState[] = [
		{ id: "done", name: "Done", type: "completed", position: 4 },
		{ id: "review", name: "In Review", type: "started", position: 3 },
		{ id: "progress", name: "In Progress", type: "started", position: 2 },
		{ id: "todo", name: "Todo", type: "unstarted", position: 1 },
		{ id: "backlog", name: "Backlog", type: "backlog", position: 0 },
	];

	it("maps columns to the team's workflow states", () => {
		expect(pickLinearStateForColumn("backlog", states)?.id).toBe("todo");
		expect(pickLinearStateForColumn("in_progress", states)?.id).toBe("progress");
		expect(pickLinearStateForColumn("review", states)?.id).toBe("review");
		expect(pickLinearStateForColumn("trash", states)?.id).toBe("done");
	});

	it("leaves review unmapped when the team has no review state", () => {
		expect(
			pickLinearStateForColumn(
				"review",
				states.filter((state) => state.id !== "review"),
			),
		).toBeNull();
	});
});
