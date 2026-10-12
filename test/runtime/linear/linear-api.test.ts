import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchLinearCustomerOpenIssues, searchLinearIssues } from "../../../src/linear/linear-api";

function stubLinearFetch(data: unknown) {
	return vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async () => new Response(JSON.stringify({ data }), { status: 200 }));
}

function sentVariables(fetchSpy: ReturnType<typeof stubLinearFetch>, call = 0): Record<string, unknown> {
	const init = fetchSpy.mock.calls[call]?.[1];
	return JSON.parse(String(init?.body)).variables;
}

describe("searchLinearIssues state filter", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it("narrows assigned issues and searches to Backlog/Todo only when asked", async () => {
		vi.stubEnv("LINEAR_API_KEY", "test-key");
		const empty = { viewer: { assignedIssues: { nodes: [] } }, searchIssues: { nodes: [] } };
		const fetchSpy = stubLinearFetch(empty);

		await searchLinearIssues("", { notStartedOnly: true });
		await searchLinearIssues("", { notStartedOnly: false });
		await searchLinearIssues("login bug", { notStartedOnly: true });
		await searchLinearIssues("login bug", { notStartedOnly: false });

		expect(sentVariables(fetchSpy, 0).filter).toEqual({ state: { type: { in: ["backlog", "unstarted"] } } });
		expect(sentVariables(fetchSpy, 1).filter).toEqual({ state: { type: { nin: ["completed", "canceled"] } } });
		expect(sentVariables(fetchSpy, 2).filter).toEqual({ state: { type: { in: ["backlog", "unstarted"] } } });
		expect(sentVariables(fetchSpy, 3).filter).toBeUndefined();
	});

	it("never filters out explicitly pasted identifiers", async () => {
		vi.stubEnv("LINEAR_API_KEY", "test-key");
		const fetchSpy = stubLinearFetch({
			issue: { id: "1", identifier: "ENG-1", title: "Done one", url: "u", state: { name: "Done" } },
		});

		const issues = await searchLinearIssues("ENG-1", { notStartedOnly: true });

		expect(issues.map((issue) => issue.identifier)).toEqual(["ENG-1"]);
		expect(sentVariables(fetchSpy).filter).toBeUndefined();
	});
});

describe("fetchLinearCustomerOpenIssues", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it("filters by customer request and Backlog/Todo state, following pagination", async () => {
		vi.stubEnv("LINEAR_API_KEY", "test-key");
		const issueNode = (n: number) => ({
			id: `${n}`,
			identifier: `MD-${n}`,
			title: `T${n}`,
			url: "u",
			description: null,
		});
		const pages = [
			{ issues: { nodes: [issueNode(1)], pageInfo: { hasNextPage: true, endCursor: "c1" } } },
			{ issues: { nodes: [issueNode(2)], pageInfo: { hasNextPage: false, endCursor: null } } },
		];
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => new Response(JSON.stringify({ data: pages.shift() }), { status: 200 }));

		const issues = await fetchLinearCustomerOpenIssues("cust-1");

		expect(issues.map((issue) => issue.identifier)).toEqual(["MD-1", "MD-2"]);
		expect(sentVariables(fetchSpy, 0)).toMatchObject({
			after: null,
			filter: {
				state: { type: { in: ["backlog", "unstarted"] } },
				needs: { some: { customer: { id: { eq: "cust-1" } } } },
			},
		});
		expect(sentVariables(fetchSpy, 1).after).toBe("c1");
	});
});
