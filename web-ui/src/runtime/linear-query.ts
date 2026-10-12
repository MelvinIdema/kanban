// Browser-side query helpers for the Linear integration.
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeLinearCustomer,
	RuntimeLinearImportIssuesResponse,
	RuntimeLinearIssueSummary,
	RuntimeLinearStatusResponse,
} from "@/runtime/types";

export async function fetchLinearStatus(workspaceId: string | null): Promise<RuntimeLinearStatusResponse> {
	return await getRuntimeTrpcClient(workspaceId).linear.getStatus.query();
}

export async function saveLinearApiKey(
	workspaceId: string | null,
	apiKey: string,
): Promise<RuntimeLinearStatusResponse> {
	return await getRuntimeTrpcClient(workspaceId).linear.setApiKey.mutate({ apiKey });
}

export async function searchLinearIssues(
	workspaceId: string | null,
	query: string,
	notStartedOnly: boolean,
): Promise<RuntimeLinearIssueSummary[]> {
	const response = await getRuntimeTrpcClient(workspaceId).linear.searchIssues.query({ query, notStartedOnly });
	return response.issues;
}

export async function importLinearIssues(
	workspaceId: string,
	issueIds: string[],
): Promise<RuntimeLinearImportIssuesResponse> {
	return await getRuntimeTrpcClient(workspaceId).workspace.importLinearIssues.mutate({ issueIds });
}

export async function searchLinearCustomers(
	workspaceId: string | null,
	query: string,
): Promise<RuntimeLinearCustomer[]> {
	const response = await getRuntimeTrpcClient(workspaceId).linear.searchCustomers.query({ query });
	return response.customers;
}

export async function fetchLinearCustomerLink(workspaceId: string): Promise<RuntimeLinearCustomer | null> {
	const response = await getRuntimeTrpcClient(workspaceId).workspace.getLinearCustomerLink.query();
	return response.customer;
}

export async function saveLinearCustomerLink(
	workspaceId: string,
	customer: RuntimeLinearCustomer | null,
): Promise<RuntimeLinearCustomer | null> {
	const response = await getRuntimeTrpcClient(workspaceId).workspace.setLinearCustomerLink.mutate({ customer });
	return response.customer;
}

export async function syncLinearCustomerIssues(workspaceId: string): Promise<RuntimeLinearImportIssuesResponse> {
	return await getRuntimeTrpcClient(workspaceId).workspace.syncLinearCustomerIssues.mutate();
}
