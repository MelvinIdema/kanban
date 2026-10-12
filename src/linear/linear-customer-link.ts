// Which Linear customer a kanban project is linked to. Stored next to the
// project's board state (~/.cline/kanban/workspaces/<id>/linear.json), so it is
// shared by the runtime and the CLI and removed together with the project.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { type RuntimeLinearCustomer, runtimeLinearCustomerLinkSchema } from "../core/api-contract";
import { loadWorkspaceContext } from "../state/workspace-state";

const LINK_FILENAME = "linear.json";

async function getLinkFilePath(workspacePath: string): Promise<string> {
	const context = await loadWorkspaceContext(workspacePath, { autoCreateIfMissing: false });
	return join(context.statePath, LINK_FILENAME);
}

export async function readLinkedLinearCustomer(workspacePath: string): Promise<RuntimeLinearCustomer | null> {
	try {
		const raw = JSON.parse(await readFile(await getLinkFilePath(workspacePath), "utf8"));
		return runtimeLinearCustomerLinkSchema.safeParse(raw).data?.customer ?? null;
	} catch {
		return null;
	}
}

export async function writeLinkedLinearCustomer(
	workspacePath: string,
	customer: RuntimeLinearCustomer | null,
): Promise<void> {
	const path = await getLinkFilePath(workspacePath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify({ customer }, null, 2)}\n`);
}
