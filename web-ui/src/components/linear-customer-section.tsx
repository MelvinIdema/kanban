import { RefreshCw, Search, Users } from "lucide-react";
import { type FormEvent, type ReactElement, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useLinearCustomerLink } from "@/hooks/use-linear-customer-link";

const INPUT_CLASS_NAME =
	"w-full h-8 px-2.5 text-[13px] rounded-md border border-border bg-surface-2 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent";

/** Links the project to a Linear customer and imports that customer's Backlog/Todo issues on demand. */
export function LinearCustomerSection({
	enabled,
	workspaceId,
}: {
	enabled: boolean;
	workspaceId: string | null;
}): ReactElement | null {
	const { linkedCustomer, customers, isSearching, isSyncing, error, searchCustomers, linkCustomer, syncNow } =
		useLinearCustomerLink(enabled, workspaceId);
	const [isPicking, setIsPicking] = useState(false);
	const [query, setQuery] = useState("");

	if (!enabled || !workspaceId || linkedCustomer === undefined) {
		return null;
	}

	const openPicker = () => {
		setIsPicking(true);
		setQuery("");
		void searchCustomers("");
	};

	const handleSearch = (event: FormEvent) => {
		event.preventDefault();
		void searchCustomers(query);
	};

	const handleSync = async () => {
		const result = await syncNow();
		if (!result) {
			return;
		}
		const skipped = result.skippedCount > 0 ? ` (${result.skippedCount} already on the board)` : "";
		showAppToast({
			intent: "success",
			message: `Synced ${linkedCustomer?.name}: imported ${result.importedCount} issue${result.importedCount === 1 ? "" : "s"}${skipped}.`,
		});
	};

	return (
		<div className="flex flex-col gap-2 rounded-md border border-border bg-surface-0 p-2.5">
			<div className="flex items-center gap-2 text-[13px]">
				<Users size={14} className="shrink-0 text-text-secondary" />
				{linkedCustomer ? (
					<>
						<span className="text-text-secondary">Customer</span>
						<span className="min-w-0 flex-1 truncate font-semibold text-text-primary">{linkedCustomer.name}</span>
						<Button
							size="sm"
							icon={isSyncing ? <Spinner size={12} /> : <RefreshCw size={12} />}
							disabled={isSyncing}
							title="Import all Backlog and Todo issues requested by this customer"
							onClick={() => void handleSync()}
						>
							Sync now
						</Button>
						<Button size="sm" variant="ghost" disabled={isSyncing} onClick={() => void linkCustomer(null)}>
							Unlink
						</Button>
					</>
				) : (
					<>
						<span className="min-w-0 flex-1 text-text-secondary">No Linear customer linked to this project.</span>
						{isPicking ? null : (
							<Button size="sm" onClick={openPicker}>
								Link customer
							</Button>
						)}
					</>
				)}
			</div>

			{!linkedCustomer && isPicking ? (
				<>
					<form onSubmit={handleSearch} className="flex gap-2">
						<input
							type="text"
							aria-label="Search Linear customers"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search customers"
							className={INPUT_CLASS_NAME}
						/>
						<Button type="submit" icon={<Search size={14} />} className="shrink-0" disabled={isSearching}>
							Search
						</Button>
						<Button type="button" variant="ghost" className="shrink-0" onClick={() => setIsPicking(false)}>
							Cancel
						</Button>
					</form>
					<div className="max-h-40 overflow-y-auto rounded-md border border-border">
						{isSearching ? (
							<div className="flex justify-center py-3">
								<Spinner size={14} />
							</div>
						) : customers.length === 0 ? (
							<p className="m-0 py-3 text-center text-[13px] text-text-tertiary">No customers found.</p>
						) : (
							customers.map((customer) => (
								<button
									key={customer.id}
									type="button"
									onClick={() => {
										setIsPicking(false);
										void linkCustomer(customer);
									}}
									className="block w-full truncate border-b border-border px-2.5 py-1.5 text-left text-[13px] text-text-primary last:border-b-0 hover:bg-surface-2"
								>
									{customer.name}
								</button>
							))
						)}
					</div>
				</>
			) : null}

			{error ? <p className="m-0 text-[13px] text-status-red">{error}</p> : null}
		</div>
	);
}
