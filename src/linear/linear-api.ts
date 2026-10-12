// Thin client for Linear's GraphQL API, authenticated with a personal API key.
// The key comes from LINEAR_API_KEY or ~/.cline/kanban/linear.json (mode 0600),
// and never leaves the runtime: the web UI only learns whether one is set.
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import type { RuntimeLinearCustomer, RuntimeLinearIssueSummary } from "../core/api-contract";
import { getRuntimeHomePath } from "../state/workspace-state";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const LINEAR_REQUEST_TIMEOUT_MS = 15_000;
const LINEAR_KEY_FILENAME = "linear.json";
const ISSUE_LIST_LIMIT = 50;
const CUSTOMER_ISSUES_PAGE_SIZE = 100;
const CUSTOMER_ISSUES_MAX_PAGES = 10;

const linearKeyFileSchema = z.object({ apiKey: z.string() });

const issueSummaryFields = "id identifier title url state { name }";

const linearIssueSummaryNodeSchema = z.object({
	id: z.string(),
	identifier: z.string(),
	title: z.string(),
	url: z.string(),
	state: z.object({ name: z.string() }),
});
type LinearIssueSummaryNode = z.infer<typeof linearIssueSummaryNodeSchema>;

const linearIssueDetailSchema = z.object({
	id: z.string(),
	identifier: z.string(),
	title: z.string(),
	url: z.string(),
	description: z.string().nullable(),
});
export type LinearIssueDetail = z.infer<typeof linearIssueDetailSchema>;

const linearIssuePageSchema = z.object({
	issues: z.object({
		nodes: z.array(linearIssueDetailSchema),
		pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
	}),
});

const linearWorkflowStateSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: z.string(),
	position: z.number(),
});
export type LinearWorkflowState = z.infer<typeof linearWorkflowStateSchema>;

const linearIssueWorkflowSchema = z.object({
	state: z.object({ id: z.string() }),
	team: z.object({ states: z.object({ nodes: z.array(linearWorkflowStateSchema) }) }),
});
export type LinearIssueWorkflow = z.infer<typeof linearIssueWorkflowSchema>;

function getLinearKeyFilePath(): string {
	return join(getRuntimeHomePath(), LINEAR_KEY_FILENAME);
}

export async function readLinearApiKey(): Promise<string | null> {
	const fromEnv = process.env.LINEAR_API_KEY?.trim();
	if (fromEnv) {
		return fromEnv;
	}
	try {
		const parsed = linearKeyFileSchema.safeParse(JSON.parse(await readFile(getLinearKeyFilePath(), "utf8")));
		return parsed.success && parsed.data.apiKey.trim() ? parsed.data.apiKey.trim() : null;
	} catch {
		return null;
	}
}

export async function saveLinearApiKey(apiKey: string): Promise<void> {
	const path = getLinearKeyFilePath();
	await writeFile(path, `${JSON.stringify({ apiKey: apiKey.trim() })}\n`, { mode: 0o600 });
	// writeFile only applies mode on create; tighten an existing file too.
	await chmod(path, 0o600);
}

async function requireLinearApiKey(): Promise<string> {
	const apiKey = await readLinearApiKey();
	if (!apiKey) {
		throw new Error("No Linear API key configured.");
	}
	return apiKey;
}

async function linearRequest<T>(
	query: string,
	variables: Record<string, unknown>,
	dataSchema: z.ZodType<T>,
): Promise<T> {
	const response = await fetch(LINEAR_GRAPHQL_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: await requireLinearApiKey(),
		},
		body: JSON.stringify({ query, variables }),
		signal: AbortSignal.timeout(LINEAR_REQUEST_TIMEOUT_MS),
	});
	const body = (await response.json().catch(() => null)) as {
		data?: unknown;
		errors?: Array<{ message?: string }>;
	} | null;
	if (!response.ok || body?.errors?.length) {
		const message = body?.errors?.[0]?.message ?? `HTTP ${response.status}`;
		throw new Error(`Linear request failed: ${message}`);
	}
	const parsed = dataSchema.safeParse(body?.data);
	if (!parsed.success) {
		throw new Error("Linear returned an unexpected response.");
	}
	return parsed.data;
}

function toIssueSummary(node: LinearIssueSummaryNode): RuntimeLinearIssueSummary {
	return {
		id: node.id,
		identifier: node.identifier,
		title: node.title,
		url: node.url,
		stateName: node.state.name,
	};
}

const ISSUE_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

function buildIssueStateFilter(notStartedOnly: boolean): Record<string, unknown> {
	return notStartedOnly
		? { state: { type: { in: ["backlog", "unstarted"] } } }
		: { state: { type: { nin: ["completed", "canceled"] } } };
}

/**
 * Empty query lists the viewer's open assigned issues. A query made only of
 * identifiers ("ENG-1, ENG-2") fetches those issues directly. Anything else is a
 * full-text search. notStartedOnly narrows lists and searches to Backlog/Todo
 * states; pasted identifiers are explicit, so they are never filtered out.
 */
export async function searchLinearIssues(
	query: string,
	{ notStartedOnly = false }: { notStartedOnly?: boolean } = {},
): Promise<RuntimeLinearIssueSummary[]> {
	const trimmed = query.trim();
	if (!trimmed) {
		const data = await linearRequest(
			`query($first: Int!, $filter: IssueFilter) { viewer { assignedIssues(first: $first, orderBy: updatedAt, filter: $filter) { nodes { ${issueSummaryFields} } } } }`,
			{ first: ISSUE_LIST_LIMIT, filter: buildIssueStateFilter(notStartedOnly) },
			z.object({ viewer: z.object({ assignedIssues: z.object({ nodes: z.array(linearIssueSummaryNodeSchema) }) }) }),
		);
		return data.viewer.assignedIssues.nodes.map(toIssueSummary);
	}
	const tokens = trimmed.split(/[\s,]+/).filter(Boolean);
	if (tokens.every((token) => ISSUE_IDENTIFIER_PATTERN.test(token))) {
		const issues = await Promise.all(
			tokens.map((identifier) =>
				linearRequest(
					`query($id: String!) { issue(id: $id) { ${issueSummaryFields} } }`,
					{ id: identifier.toUpperCase() },
					z.object({ issue: linearIssueSummaryNodeSchema }),
				)
					.then((data) => toIssueSummary(data.issue))
					.catch(() => null),
			),
		);
		return issues.filter((issue): issue is RuntimeLinearIssueSummary => issue !== null);
	}
	const data = await linearRequest(
		`query($term: String!, $first: Int!, $filter: IssueFilter) { searchIssues(term: $term, first: $first, filter: $filter) { nodes { ${issueSummaryFields} } } }`,
		{ term: trimmed, first: ISSUE_LIST_LIMIT, filter: notStartedOnly ? buildIssueStateFilter(true) : undefined },
		z.object({ searchIssues: z.object({ nodes: z.array(linearIssueSummaryNodeSchema) }) }),
	);
	return data.searchIssues.nodes.map(toIssueSummary);
}

export async function searchLinearCustomers(query: string): Promise<RuntimeLinearCustomer[]> {
	const trimmed = query.trim();
	const data = await linearRequest(
		"query($first: Int!, $filter: CustomerFilter) { customers(first: $first, filter: $filter) { nodes { id name } } }",
		{ first: ISSUE_LIST_LIMIT, filter: trimmed ? { name: { containsIgnoreCase: trimmed } } : undefined },
		z.object({ customers: z.object({ nodes: z.array(z.object({ id: z.string(), name: z.string() })) }) }),
	);
	return data.customers.nodes.map((customer) => ({ id: customer.id, name: customer.name.trim() }));
}

/** Backlog/Todo issues that have at least one request from the customer. */
export async function fetchLinearCustomerOpenIssues(customerId: string): Promise<LinearIssueDetail[]> {
	const issues: LinearIssueDetail[] = [];
	let after: string | null = null;
	// ponytail: capped at CUSTOMER_ISSUES_MAX_PAGES * page size (1000 issues); raise if a customer ever has more open.
	for (let page = 0; page < CUSTOMER_ISSUES_MAX_PAGES; page++) {
		const data: z.infer<typeof linearIssuePageSchema> = await linearRequest(
			"query($first: Int!, $after: String, $filter: IssueFilter) { issues(first: $first, after: $after, filter: $filter) { nodes { id identifier title url description } pageInfo { hasNextPage endCursor } } }",
			{
				first: CUSTOMER_ISSUES_PAGE_SIZE,
				after,
				filter: { ...buildIssueStateFilter(true), needs: { some: { customer: { id: { eq: customerId } } } } },
			},
			linearIssuePageSchema,
		);
		issues.push(...data.issues.nodes);
		if (!data.issues.pageInfo.hasNextPage || !data.issues.pageInfo.endCursor) {
			break;
		}
		after = data.issues.pageInfo.endCursor;
	}
	return issues;
}

export async function fetchLinearIssueDetail(issueId: string): Promise<LinearIssueDetail> {
	const data = await linearRequest(
		"query($id: String!) { issue(id: $id) { id identifier title url description } }",
		{ id: issueId },
		z.object({ issue: linearIssueDetailSchema }),
	);
	return data.issue;
}

export async function fetchLinearIssueWorkflow(issueId: string): Promise<LinearIssueWorkflow> {
	const data = await linearRequest(
		"query($id: String!) { issue(id: $id) { state { id } team { states { nodes { id name type position } } } } }",
		{ id: issueId },
		z.object({ issue: linearIssueWorkflowSchema }),
	);
	return data.issue;
}

export async function updateLinearIssueState(issueId: string, stateId: string): Promise<void> {
	await linearRequest(
		"mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }",
		{ id: issueId, stateId },
		z.object({ issueUpdate: z.object({ success: z.boolean() }) }),
	);
}
