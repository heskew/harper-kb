/**
 * Knowledge Base Management
 *
 * CRUD operations for the KnowledgeBase registry table.
 * Each KB is a tenant — entries, tags, triage items, etc. are scoped to a KB.
 */

import type { KnowledgeBase, KnowledgeBaseInput, KnowledgeBaseUpdate } from '../types.ts';

/**
 * Create a new knowledge base.
 *
 * @param data - KB data to create
 * @returns The created knowledge base
 * @throws Error if a KB with the same id already exists
 */
export async function createKnowledgeBase(data: KnowledgeBaseInput): Promise<KnowledgeBase> {
	const existing = await databases.kb.KnowledgeBase.get(data.id);
	if (existing) {
		throw new Error(`Knowledge base already exists: ${data.id}`);
	}

	const kb: KnowledgeBase = {
		id: data.id,
		name: data.name,
		description: data.description,
		settings: data.settings,
		createdBy: data.createdBy,
	};

	await databases.kb.KnowledgeBase.put(kb as unknown as Record<string, unknown>);

	return kb;
}

/**
 * Get a knowledge base by ID.
 *
 * @param id - KB identifier
 * @returns The KB record, or null if not found
 */
export async function getKnowledgeBase(id: string): Promise<KnowledgeBase | null> {
	const record = await databases.kb.KnowledgeBase.get(id);
	if (!record) return null;

	return {
		id: record.id as string,
		name: record.name as string,
		description: record.description as string | undefined,
		settings: record.settings as Record<string, unknown> | undefined,
		createdBy: record.createdBy as string | undefined,
		createdAt: record.createdAt as Date | undefined,
		updatedAt: record.updatedAt as Date | undefined,
	};
}

/**
 * Update an existing knowledge base.
 *
 * @param id - KB identifier
 * @param data - Fields to update
 * @returns The updated KB record
 * @throws Error if the KB does not exist
 */
export async function updateKnowledgeBase(id: string, data: KnowledgeBaseUpdate): Promise<KnowledgeBase> {
	const existing = await databases.kb.KnowledgeBase.get(id);
	if (!existing) {
		throw new Error(`Knowledge base not found: ${id}`);
	}

	const updated: Record<string, unknown> = { ...existing, id };
	if (data.name !== undefined) updated.name = data.name;
	if (data.description !== undefined) updated.description = data.description;
	if (data.settings !== undefined) updated.settings = data.settings;

	await databases.kb.KnowledgeBase.put(updated);

	return {
		id: updated.id as string,
		name: updated.name as string,
		description: updated.description as string | undefined,
		settings: updated.settings as Record<string, unknown> | undefined,
		createdBy: updated.createdBy as string | undefined,
		createdAt: updated.createdAt as Date | undefined,
		updatedAt: updated.updatedAt as Date | undefined,
	};
}

/**
 * Delete a knowledge base.
 *
 * Only deletes the registry record — does NOT cascade to entries, tags, etc.
 * The caller is responsible for cleanup or can leave orphaned data for
 * eventual consistency.
 *
 * @param id - KB identifier
 * @throws Error if the KB does not exist
 */
export async function deleteKnowledgeBase(id: string): Promise<void> {
	const existing = await databases.kb.KnowledgeBase.get(id);
	if (!existing) {
		throw new Error(`Knowledge base not found: ${id}`);
	}
	await databases.kb.KnowledgeBase.delete(id);
}

/**
 * List all knowledge bases.
 *
 * @returns Array of KB records
 */
export async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
	const results: KnowledgeBase[] = [];
	for await (const record of databases.kb.KnowledgeBase.search({})) {
		results.push({
			id: record.id as string,
			name: record.name as string,
			description: record.description as string | undefined,
			settings: record.settings as Record<string, unknown> | undefined,
			createdBy: record.createdBy as string | undefined,
			createdAt: record.createdAt as Date | undefined,
			updatedAt: record.updatedAt as Date | undefined,
		});
	}
	return results;
}
