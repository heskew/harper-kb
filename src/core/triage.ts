/**
 * Triage Queue Management
 *
 * Handles the intake queue for new knowledge submissions from webhooks
 * and other sources. Items go through pending -> processing -> accepted/dismissed.
 *
 * All operations are scoped by kbId for multi-tenant isolation.
 */

import crypto from 'node:crypto';
import { createEntry } from './entries.ts';
import type { TriageItem, TriageAction, TriageProcessOptions, KnowledgeEntryInput } from '../types.ts';

/**
 * Submit a new item to the triage queue.
 *
 * @param kbId - Knowledge base identifier
 * @param source - Source identifier (e.g., "github-webhook", "slack-bot", "manual")
 * @param summary - Brief summary of the knowledge to triage
 * @param rawPayload - Original raw payload from the source
 * @param sourceId - Optional deduplication key from the source system
 * @returns The created triage item
 */
export async function submitTriage(
	kbId: string,
	source: string,
	summary: string,
	rawPayload?: unknown,
	sourceId?: string
): Promise<TriageItem> {
	const item: TriageItem = {
		id: crypto.randomUUID(),
		kbId,
		source,
		summary,
		rawPayload: rawPayload || null,
		status: 'pending',
		sourceId: sourceId || undefined,
	};

	await databases.kb.TriageItem.put(item as unknown as Record<string, unknown>);

	logger?.info?.(`Triage item submitted: ${item.id} from ${source}`);

	return item;
}

/**
 * Find a triage item by its source-specific ID for deduplication.
 *
 * @param kbId - Knowledge base identifier
 * @param sourceId - The source-specific identifier
 * @returns The matching triage item, or null if not found
 */
export async function findBySourceId(kbId: string, sourceId: string): Promise<TriageItem | null> {
	for await (const item of databases.kb.TriageItem.search({
		conditions: [
			{ attribute: 'kbId', comparator: 'equals', value: kbId },
			{ attribute: 'sourceId', comparator: 'equals', value: sourceId },
		],
		limit: 1,
	})) {
		return item as unknown as TriageItem;
	}
	return null;
}

/**
 * Process a triage item with the given action.
 *
 * - "accepted": Optionally creates a new knowledge entry from provided data
 * - "dismissed": Marks the item as dismissed
 * - "linked": Links the triage item to an existing knowledge entry
 *
 * @param id - Triage item ID
 * @param action - Action to take
 * @param processedBy - Who processed this item
 * @param options - Additional options (entry data for accept, linked entry ID)
 * @returns The updated triage item
 * @throws Error if the triage item does not exist
 */
export async function processTriage(
	id: string,
	action: TriageAction,
	processedBy: string,
	options?: TriageProcessOptions
): Promise<TriageItem> {
	const existing = await databases.kb.TriageItem.get(id);
	if (!existing) {
		throw new Error(`Triage item not found: ${id}`);
	}

	const item = existing as unknown as TriageItem;
	const now = new Date();

	// Update common fields
	item.status = action;
	item.action = action;
	item.processedBy = processedBy;
	item.processedAt = now;

	// Handle action-specific logic
	if (action === 'accepted' && options?.entryData) {
		// Create a new knowledge entry from the triage data
		const entryData: KnowledgeEntryInput = {
			...options.entryData,
			kbId: item.kbId,
			source: options.entryData.source || item.source,
			addedBy: options.entryData.addedBy || processedBy,
		};

		const entry = await createEntry(entryData);
		item.draftEntryId = entry.id;
	} else if (action === 'accepted' && options?.linkedEntryId) {
		// Entry was created externally (e.g., web UI created it first) — link it
		item.draftEntryId = options.linkedEntryId;
	} else if (action === 'linked' && options?.linkedEntryId) {
		// Link to an existing knowledge entry
		item.matchedEntryId = options.linkedEntryId;
	}

	// Store the updated triage item
	await databases.kb.TriageItem.put(item as unknown as Record<string, unknown>);

	logger?.info?.(`Triage item ${id} processed: ${action} by ${processedBy}`);

	return item;
}

/**
 * List pending triage items for a specific knowledge base.
 *
 * @param kbId - Knowledge base identifier
 * @param limit - Maximum number of items to return (default 200)
 * @returns Array of triage items with status "pending"
 */
export async function listPending(kbId: string, limit = 200): Promise<TriageItem[]> {
	const results: TriageItem[] = [];
	for await (const item of databases.kb.TriageItem.search({
		conditions: [
			{ attribute: 'kbId', comparator: 'equals', value: kbId },
			{ attribute: 'status', comparator: 'equals', value: 'pending' },
		],
		limit,
	})) {
		results.push(item as unknown as TriageItem);
	}
	return results;
}

/**
 * Dismiss a triage item.
 *
 * Convenience method that calls processTriage with action "dismissed".
 *
 * @param id - Triage item ID
 * @param processedBy - Who dismissed this item
 */
export async function dismissTriage(id: string, processedBy: string): Promise<void> {
	await processTriage(id, 'dismissed', processedBy);
}
