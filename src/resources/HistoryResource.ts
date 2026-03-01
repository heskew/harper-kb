/**
 * History Resource
 *
 * REST endpoint for knowledge entry edit history.
 * All operations require kbId query parameter for tenant scoping.
 *
 * Routes:
 *   GET /History/<entryId>?kbId=..  — get edit history for a knowledge entry
 */

import { getHistory } from '../core/history.ts';
import { getEntry } from '../core/entries.ts';

function getResourceClass(): any {
	return (globalThis as any).Resource;
}

function extractKbId(target?: any): string | null {
	return target?.get?.('kbId') || target?.kbId || null;
}

export class HistoryResource extends getResourceClass() {
	static loadAsInstance = false;

	/**
	 * GET /History/<entryId>?kbId=.. — get edit history for a knowledge entry.
	 * Public read access (same as KnowledgeEntry).
	 */
	async get(target?: any) {
		const kbId = extractKbId(target);
		if (!kbId) {
			return { status: 400, data: { error: 'kbId query parameter is required' } };
		}

		const entryId = this.getId();
		if (!entryId) {
			return {
				status: 400,
				data: { error: 'Entry ID required: GET /History/<entryId>?kbId=..' },
			};
		}

		// Verify entry belongs to this KB
		const entry = await getEntry(String(entryId));
		if (!entry || entry.kbId !== kbId) {
			return { status: 404, data: { error: 'Knowledge entry not found' } };
		}

		const limitParam = target?.get?.('limit') || target?.limit;
		const limit = limitParam ? parseInt(String(limitParam), 10) : 50;

		const edits = await getHistory(String(entryId), limit);
		// Strip sensitive fields from public responses (usernames, previous values).
		// Harper records use non-enumerable properties, so we must read fields explicitly.
		const publicEdits = edits.map((edit) => ({
			id: edit.id,
			kbId: edit.kbId,
			entryId: edit.entryId,
			editSummary: edit.editSummary,
			changedFields: edit.changedFields,
			createdAt: edit.createdAt,
		}));
		return {
			entryId: String(entryId),
			editCount: publicEdits.length,
			edits: publicEdits,
		};
	}
}
