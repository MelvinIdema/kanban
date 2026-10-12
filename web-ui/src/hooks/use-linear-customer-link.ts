import { useCallback, useEffect, useState } from "react";

import {
	fetchLinearCustomerLink,
	saveLinearCustomerLink,
	searchLinearCustomers,
	syncLinearCustomerIssues,
} from "@/runtime/linear-query";
import type { RuntimeLinearCustomer, RuntimeLinearImportIssuesResponse } from "@/runtime/types";

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export interface UseLinearCustomerLinkResult {
	/** undefined while loading, null when the project has no linked customer. */
	linkedCustomer: RuntimeLinearCustomer | null | undefined;
	customers: RuntimeLinearCustomer[];
	isSearching: boolean;
	isSyncing: boolean;
	error: string | null;
	searchCustomers: (query: string) => Promise<void>;
	linkCustomer: (customer: RuntimeLinearCustomer | null) => Promise<void>;
	syncNow: () => Promise<RuntimeLinearImportIssuesResponse | null>;
}

/** Loads and edits the Linear customer linked to a project. Only active while enabled (dialog open, key set). */
export function useLinearCustomerLink(enabled: boolean, workspaceId: string | null): UseLinearCustomerLinkResult {
	const [linkedCustomer, setLinkedCustomer] = useState<RuntimeLinearCustomer | null | undefined>(undefined);
	const [customers, setCustomers] = useState<RuntimeLinearCustomer[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [isSyncing, setIsSyncing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!enabled || !workspaceId) {
			return;
		}
		let cancelled = false;
		setLinkedCustomer(undefined);
		setCustomers([]);
		setError(null);
		void fetchLinearCustomerLink(workspaceId)
			.then((customer) => {
				if (!cancelled) {
					setLinkedCustomer(customer);
				}
			})
			.catch((loadError: unknown) => {
				if (!cancelled) {
					setLinkedCustomer(null);
					setError(toErrorMessage(loadError));
				}
			});
		return () => {
			cancelled = true;
		};
	}, [enabled, workspaceId]);

	const searchCustomers = useCallback(
		async (query: string) => {
			setIsSearching(true);
			setError(null);
			try {
				setCustomers(await searchLinearCustomers(workspaceId, query));
			} catch (searchError) {
				setError(toErrorMessage(searchError));
			} finally {
				setIsSearching(false);
			}
		},
		[workspaceId],
	);

	const linkCustomer = useCallback(
		async (customer: RuntimeLinearCustomer | null) => {
			if (!workspaceId) {
				return;
			}
			setError(null);
			try {
				setLinkedCustomer(await saveLinearCustomerLink(workspaceId, customer));
			} catch (linkError) {
				setError(toErrorMessage(linkError));
			}
		},
		[workspaceId],
	);

	const syncNow = useCallback(async () => {
		if (!workspaceId) {
			return null;
		}
		setIsSyncing(true);
		setError(null);
		try {
			return await syncLinearCustomerIssues(workspaceId);
		} catch (syncError) {
			setError(toErrorMessage(syncError));
			return null;
		} finally {
			setIsSyncing(false);
		}
	}, [workspaceId]);

	return { linkedCustomer, customers, isSearching, isSyncing, error, searchCustomers, linkCustomer, syncNow };
}
