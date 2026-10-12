import { useCallback, useEffect, useRef, useState } from "react";

import { fetchLinearStatus, importLinearIssues, saveLinearApiKey, searchLinearIssues } from "@/runtime/linear-query";
import type { RuntimeLinearImportIssuesResponse, RuntimeLinearIssueSummary } from "@/runtime/types";

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export interface UseLinearImportResult {
	/** null while the key status is loading. */
	hasApiKey: boolean | null;
	issues: RuntimeLinearIssueSummary[];
	isLoading: boolean;
	error: string | null;
	search: (query: string) => Promise<void>;
	/** Only Backlog/Todo issues. Changing it re-runs the last search. */
	notStartedOnly: boolean;
	setNotStartedOnly: (notStartedOnly: boolean) => void;
	saveApiKey: (apiKey: string) => Promise<void>;
	importIssues: (issueIds: string[]) => Promise<RuntimeLinearImportIssuesResponse>;
}

export function useLinearImport(open: boolean, workspaceId: string | null): UseLinearImportResult {
	const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
	const [issues, setIssues] = useState<RuntimeLinearIssueSummary[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notStartedOnly, setNotStartedOnlyState] = useState(true);
	const latestSearchRef = useRef(0);
	// Refs so search stays stable: the open effect depends on it and must not re-run on filter changes.
	const notStartedOnlyRef = useRef(notStartedOnly);
	const lastQueryRef = useRef("");

	const search = useCallback(
		async (query: string) => {
			const searchId = ++latestSearchRef.current;
			lastQueryRef.current = query;
			setIsLoading(true);
			setError(null);
			try {
				const nextIssues = await searchLinearIssues(workspaceId, query, notStartedOnlyRef.current);
				if (searchId === latestSearchRef.current) {
					setIssues(nextIssues);
				}
			} catch (searchError) {
				if (searchId === latestSearchRef.current) {
					setError(toErrorMessage(searchError));
				}
			} finally {
				if (searchId === latestSearchRef.current) {
					setIsLoading(false);
				}
			}
		},
		[workspaceId],
	);

	useEffect(() => {
		if (!open) {
			return;
		}
		let cancelled = false;
		setHasApiKey(null);
		setIssues([]);
		setError(null);
		void fetchLinearStatus(workspaceId)
			.then((status) => {
				if (cancelled) {
					return;
				}
				setHasApiKey(status.hasApiKey);
				if (status.hasApiKey) {
					void search("");
				}
			})
			.catch((statusError: unknown) => {
				if (!cancelled) {
					setError(toErrorMessage(statusError));
				}
			});
		return () => {
			cancelled = true;
		};
	}, [open, workspaceId, search]);

	const saveApiKey = useCallback(
		async (apiKey: string) => {
			setError(null);
			try {
				const status = await saveLinearApiKey(workspaceId, apiKey);
				setHasApiKey(status.hasApiKey);
				if (status.hasApiKey) {
					await search("");
				}
			} catch (saveError) {
				setError(toErrorMessage(saveError));
			}
		},
		[workspaceId, search],
	);

	const setNotStartedOnly = useCallback(
		(nextNotStartedOnly: boolean) => {
			notStartedOnlyRef.current = nextNotStartedOnly;
			setNotStartedOnlyState(nextNotStartedOnly);
			void search(lastQueryRef.current);
		},
		[search],
	);

	const importIssues = useCallback(
		async (issueIds: string[]) => {
			if (!workspaceId) {
				throw new Error("Open a project before importing Linear issues.");
			}
			return await importLinearIssues(workspaceId, issueIds);
		},
		[workspaceId],
	);

	return {
		hasApiKey,
		issues,
		isLoading,
		error,
		search,
		notStartedOnly,
		setNotStartedOnly,
		saveApiKey,
		importIssues,
	};
}
