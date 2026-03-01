/**
 * Knowledge Entry Management
 *
 * CRUD operations for knowledge base entries. Handles embedding generation,
 * tag synchronization, and relationship management.
 */

import crypto from 'node:crypto';
import { generateEmbedding } from './embeddings.ts';
import { syncTags } from './tags.ts';
import { logEdit } from './history.ts';
import type { KnowledgeEntry, KnowledgeEntryInput, KnowledgeEntryUpdate } from '../types.ts';

/**
 * Strip embedding vectors from an entry to keep responses compact.
 * Embeddings are large float arrays not useful in API responses.
 *
 * NOTE: Harper database records use non-enumerable properties, so
 * object spread ({...record}) produces an empty object. We must
 * explicitly read each field.
 */
export function stripEmbedding(entry: any): Omit<KnowledgeEntry, 'embedding'> {
	return {
		id: entry.id,
		kbId: entry.kbId,
		title: entry.title,
		content: entry.content,
		tags: entry.tags,
		appliesTo: entry.appliesTo,
		source: entry.source,
		sourceUrl: entry.sourceUrl,
		references: entry.references,
		confidence: entry.confidence,
		addedBy: entry.addedBy,
		reviewedBy: entry.reviewedBy,
		supersedesId: entry.supersedesId,
		supersededById: entry.supersededById,
		siblingIds: entry.siblingIds,
		relatedIds: entry.relatedIds,
		metadata: entry.metadata,
		deprecated: entry.deprecated,
		createdAt: entry.createdAt,
		updatedAt: entry.updatedAt,
		// score is present on SearchResult objects
		...(entry.score !== undefined ? { score: entry.score } : {}),
	};
}

/**
 * Create a new knowledge entry.
 *
 * Generates an embedding from title + content, synchronizes tags,
 * and stores the entry. A UUID is generated if no id is provided.
 *
 * @param data - Entry data to create
 * @returns The created knowledge entry
 */
export async function createEntry(data: KnowledgeEntryInput): Promise<KnowledgeEntry> {
	const id = data.id || crypto.randomUUID();

	// Generate embedding from title + content
	const embeddingText = `${data.title}\n\n${data.content}`;
	let embedding: number[] | undefined;
	try {
		embedding = await generateEmbedding(embeddingText);
	} catch (error) {
		logger?.warn?.('Failed to generate embedding for new entry:', (error as Error).message);
	}

	const entry: KnowledgeEntry = {
		id,
		kbId: data.kbId,
		title: data.title,
		content: data.content,
		tags: data.tags || [],
		appliesTo: data.appliesTo,
		source: data.source,
		sourceUrl: data.sourceUrl,
		references: data.references,
		confidence: data.confidence || 'ai-generated',
		addedBy: data.addedBy,
		reviewedBy: data.reviewedBy,
		metadata: data.metadata,
		deprecated: data.deprecated ?? false,
		embedding,
	};

	// Sync tag counts (no previous tags for new entries)
	if (entry.tags.length > 0) {
		await syncTags(data.kbId, entry.tags);
	}

	// Store the entry
	await databases.kb.KnowledgeEntry.put(entry as unknown as Record<string, unknown>);

	return entry;
}

/**
 * Get a knowledge entry by ID.
 *
 * @param id - Entry ID
 * @returns The entry, or null if not found
 */
export async function getEntry(id: string): Promise<KnowledgeEntry | null> {
	const entry = await databases.kb.KnowledgeEntry.get(id);
	return entry as unknown as KnowledgeEntry | null;
}

/**
 * Update an existing knowledge entry.
 *
 * Merges the update data with the existing entry. If title or content changed,
 * regenerates the embedding. Synchronizes tag counts if tags changed.
 * Optionally logs the edit to the history table.
 *
 * @param id - ID of the entry to update
 * @param data - Fields to update
 * @param options - Optional edit tracking metadata
 * @returns The updated entry
 * @throws Error if the entry does not exist
 */
export async function updateEntry(
	id: string,
	data: KnowledgeEntryUpdate,
	options?: { editedBy?: string; editSummary?: string }
): Promise<KnowledgeEntry> {
	const existing = await databases.kb.KnowledgeEntry.get(id);
	if (!existing) {
		throw new Error(`Knowledge entry not found: ${id}`);
	}

	const existingEntry = existing as unknown as KnowledgeEntry;
	const previousTags = existingEntry.tags || [];

	// Merge updates
	const updated: KnowledgeEntry = {
		...existingEntry,
		...data,
		id, // Ensure ID is never overwritten
	};

	// Regenerate embedding if title or content changed
	const titleChanged = data.title !== undefined && data.title !== existingEntry.title;
	const contentChanged = data.content !== undefined && data.content !== existingEntry.content;

	if (titleChanged || contentChanged) {
		const embeddingText = `${updated.title}\n\n${updated.content}`;
		try {
			updated.embedding = await generateEmbedding(embeddingText);
		} catch (error) {
			logger?.warn?.('Failed to regenerate embedding for entry update:', (error as Error).message);
		}
	}

	// Sync tag counts if tags changed
	if (data.tags !== undefined) {
		await syncTags(existingEntry.kbId, updated.tags, previousTags);
	}

	// Log the edit before overwriting
	if (options?.editedBy) {
		try {
			await logEdit(existingEntry.kbId, id, existingEntry, updated, options.editedBy, options.editSummary);
		} catch (error) {
			logger?.warn?.('Failed to log edit history:', (error as Error).message);
		}
	}

	// Store the updated entry
	await databases.kb.KnowledgeEntry.put(updated as unknown as Record<string, unknown>);

	return updated;
}

/**
 * Mark an entry as deprecated.
 *
 * @param id - ID of the entry to deprecate
 * @throws Error if the entry does not exist
 */
export async function deprecateEntry(id: string): Promise<void> {
	const existing = await databases.kb.KnowledgeEntry.get(id);
	if (!existing) {
		throw new Error(`Knowledge entry not found: ${id}`);
	}

	await databases.kb.KnowledgeEntry.put({
		...existing,
		id,
		deprecated: true,
	});
}

/**
 * Link a new entry as superseding an old entry.
 *
 * Sets newEntry.supersedesId = oldId and oldEntry.supersededById = newId.
 *
 * @param newId - ID of the new (superseding) entry
 * @param oldId - ID of the old (superseded) entry
 * @throws Error if either entry does not exist
 */
export async function linkSupersedes(newId: string, oldId: string): Promise<void> {
	const newEntry = await databases.kb.KnowledgeEntry.get(newId);
	const oldEntry = await databases.kb.KnowledgeEntry.get(oldId);

	if (!newEntry) {
		throw new Error(`New entry not found: ${newId}`);
	}
	if (!oldEntry) {
		throw new Error(`Old entry not found: ${oldId}`);
	}

	await databases.kb.KnowledgeEntry.put({
		...newEntry,
		id: newId,
		supersedesId: oldId,
	});

	await databases.kb.KnowledgeEntry.put({
		...oldEntry,
		id: oldId,
		supersededById: newId,
	});
}

/**
 * Link multiple entries as siblings.
 *
 * For each entry, adds all other entry IDs to its siblingIds array (deduplicated).
 *
 * @param ids - IDs of entries to link as siblings
 * @throws Error if any entry does not exist
 */
export async function linkSiblings(ids: string[]): Promise<void> {
	if (ids.length < 2) {
		return; // Need at least 2 entries to link
	}

	// Load all entries first to verify they exist
	const entries: Array<Record<string, unknown>> = [];
	for (const id of ids) {
		const entry = await databases.kb.KnowledgeEntry.get(id);
		if (!entry) {
			throw new Error(`Entry not found: ${id}`);
		}
		entries.push(entry);
	}

	// Update each entry's siblingIds
	for (let i = 0; i < ids.length; i++) {
		const entry = entries[i];
		const entryTyped = entry as unknown as KnowledgeEntry;
		const existingSiblings = new Set(entryTyped.siblingIds || []);

		// Add all other IDs (not itself)
		for (const otherId of ids) {
			if (otherId !== ids[i]) {
				existingSiblings.add(otherId);
			}
		}

		await databases.kb.KnowledgeEntry.put({
			...entry,
			id: ids[i],
			siblingIds: Array.from(existingSiblings),
		});
	}
}

/**
 * Reindex embeddings for all entries missing them.
 *
 * Iterates every KnowledgeEntry, generates embeddings for any that
 * don't have one yet, and writes them back. Returns counts of
 * processed, updated, and failed entries.
 */
export async function reindexEmbeddings(kbId: string): Promise<{
	total: number;
	updated: number;
	failed: number;
	skipped: number;
}> {
	let total = 0;
	let updated = 0;
	let failed = 0;
	let skipped = 0;

	for await (const record of databases.kb.KnowledgeEntry.search({
		conditions: [{ attribute: 'kbId', comparator: 'equals', value: kbId }],
	})) {
		total++;
		const entry = record as unknown as KnowledgeEntry;

		// Skip entries that already have embeddings
		if (entry.embedding && entry.embedding.length > 0) {
			skipped++;
			continue;
		}

		try {
			const embeddingText = `${entry.title}\n\n${entry.content}`;
			const embedding = await generateEmbedding(embeddingText);
			await databases.kb.KnowledgeEntry.put({
				...record,
				id: entry.id,
				embedding,
			});
			updated++;
			logger?.info?.(`Reindexed embedding for entry: ${entry.id}`);
		} catch (error) {
			failed++;
			logger?.warn?.(`Failed to reindex entry ${entry.id}:`, (error as Error).message);
		}
	}

	return { total, updated, failed, skipped };
}

/**
 * Link two entries as related.
 *
 * Adds relatedId to the entry's relatedIds array (deduplicated).
 * This is a one-directional link; call twice for bidirectional.
 *
 * @param id - ID of the entry to add a related link to
 * @param relatedId - ID of the related entry
 * @throws Error if the entry does not exist
 */
export async function linkRelated(id: string, relatedId: string): Promise<void> {
	const entry = await databases.kb.KnowledgeEntry.get(id);
	if (!entry) {
		throw new Error(`Entry not found: ${id}`);
	}

	const entryTyped = entry as unknown as KnowledgeEntry;
	const existingRelated = new Set(entryTyped.relatedIds || []);
	existingRelated.add(relatedId);

	await databases.kb.KnowledgeEntry.put({
		...entry,
		id,
		relatedIds: Array.from(existingRelated),
	});
}
