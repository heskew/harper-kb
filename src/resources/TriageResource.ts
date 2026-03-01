/**
 * Triage Resource
 *
 * REST endpoint for the triage intake queue.
 * All operations require kbId query parameter for tenant scoping.
 *
 * Routes:
 *   GET  /Triage/?kbId=..       — list pending triage items (team role required)
 *   POST /Triage/?kbId=..       — submit a new triage item (service_account or ai_agent role)
 *   PUT  /Triage/<id>           — process a triage item (team role required)
 */

import { submitTriage, processTriage, listPending } from '../core/triage.ts';
import type { TriageAction, TriageProcessOptions } from '../types.ts';

function getResourceClass(): any {
	return (globalThis as any).Resource;
}

function extractKbId(target?: any): string | null {
	return target?.get?.('kbId') || target?.kbId || null;
}

export class TriageResource extends getResourceClass() {
	static loadAsInstance = false;

	/**
	 * GET /Triage/?kbId=.. — list pending triage items.
	 * AUTH REQUIRED: team role only.
	 */
	async get(target?: any) {
		const user = this.getCurrentUser();
		if (!user) {
			return { status: 401, data: { error: 'Authentication required' } };
		}
		if (user.role !== 'team') {
			return { status: 403, data: { error: 'Team role required' } };
		}

		const kbId = extractKbId(target);
		if (!kbId) {
			return { status: 400, data: { error: 'kbId query parameter is required' } };
		}

		return listPending(kbId);
	}

	/**
	 * POST /Triage/?kbId=.. — submit a new triage item.
	 * AUTH REQUIRED: service_account or ai_agent role.
	 */
	async post(target: any, data: any) {
		const user = this.getCurrentUser();
		if (!user) {
			return { status: 401, data: { error: 'Authentication required' } };
		}
		if (user.role !== 'service_account' && user.role !== 'ai_agent') {
			return {
				status: 403,
				data: { error: 'service_account or ai_agent role required' },
			};
		}

		const kbId = extractKbId(target) || data?.kbId;
		if (!kbId) {
			return { status: 400, data: { error: 'kbId is required' } };
		}

		if (!data?.source || !data?.summary) {
			return {
				status: 400,
				data: { error: 'source and summary are required' },
			};
		}

		return submitTriage(kbId, data.source, data.summary, data.rawPayload);
	}

	/**
	 * PUT /Triage/<id> — process a triage item.
	 * AUTH REQUIRED: team role only.
	 *
	 * Body should include:
	 *   { action: "accepted" | "dismissed" | "linked",
	 *     processedBy?: string,
	 *     entryData?: KnowledgeEntryInput,
	 *     linkedEntryId?: string }
	 */
	async put(_target: any, data: any) {
		const user = this.getCurrentUser();
		if (!user) {
			return { status: 401, data: { error: 'Authentication required' } };
		}
		if (user.role !== 'team') {
			return { status: 403, data: { error: 'Team role required' } };
		}

		const id = this.getId();
		if (!id) {
			return { status: 400, data: { error: 'Triage item ID required' } };
		}

		if (!data?.action) {
			return {
				status: 400,
				data: { error: 'action is required (accepted, dismissed, or linked)' },
			};
		}

		if (!['accepted', 'dismissed', 'linked'].includes(data.action)) {
			return {
				status: 400,
				data: { error: 'action must be accepted, dismissed, or linked' },
			};
		}
		const action = data.action as TriageAction;
		const processedBy = data.processedBy || user.username || user.id || 'unknown';
		const options: TriageProcessOptions = {};

		if (data.entryData) {
			options.entryData = data.entryData;
		}
		if (data.linkedEntryId) {
			options.linkedEntryId = data.linkedEntryId;
		}

		try {
			return await processTriage(String(id), action, processedBy, options);
		} catch (error) {
			if ((error as Error).message.includes('not found')) {
				return { status: 404, data: { error: (error as Error).message } };
			}
			throw error;
		}
	}
}
