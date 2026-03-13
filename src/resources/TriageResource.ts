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
import { checkAccess } from '../hooks.ts';
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
	 * Default: team role required. Hook can override.
	 */
	async get(target?: any) {
		const user = this.getCurrentUser();
		const kbId = extractKbId(target);
		if (!kbId) {
			return { status: 400, data: { error: 'kbId query parameter is required' } };
		}

		const accessResult = await checkAccess({
			user,
			kbId,
			resource: 'Triage',
			operation: 'read',
			channel: 'rest',
		});
		if (accessResult) {
			if (!accessResult.allow) {
				return { status: user ? 403 : 401, data: { error: accessResult.reason || 'Access denied' } };
			}
		} else {
			if (!user) {
				return { status: 401, data: { error: 'Authentication required' } };
			}
			if (user.role !== 'team') {
				return { status: 403, data: { error: 'Team role required' } };
			}
		}

		return listPending(kbId);
	}

	/**
	 * POST /Triage/?kbId=.. — submit a new triage item.
	 * Default: service_account or ai_agent role. Hook can override.
	 */
	async post(target: any, data: any) {
		const user = this.getCurrentUser();
		const kbId = extractKbId(target) || data?.kbId;
		if (!kbId) {
			return { status: 400, data: { error: 'kbId is required' } };
		}

		const accessResult = await checkAccess({
			user,
			kbId,
			resource: 'Triage',
			operation: 'write',
			channel: 'rest',
		});
		if (accessResult) {
			if (!accessResult.allow) {
				return { status: user ? 403 : 401, data: { error: accessResult.reason || 'Access denied' } };
			}
		} else {
			if (!user) {
				return { status: 401, data: { error: 'Authentication required' } };
			}
			if (user.role !== 'service_account' && user.role !== 'ai_agent') {
				return {
					status: 403,
					data: { error: 'service_account or ai_agent role required' },
				};
			}
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
	 * Default: team role required. Hook can override.
	 *
	 * Body should include:
	 *   { action: "accepted" | "dismissed" | "linked",
	 *     processedBy?: string,
	 *     entryData?: KnowledgeEntryInput,
	 *     linkedEntryId?: string }
	 */
	async put(_target: any, data: any) {
		const user = this.getCurrentUser();
		const id = this.getId();
		if (!id) {
			return { status: 400, data: { error: 'Triage item ID required' } };
		}

		const accessResult = await checkAccess({
			user,
			kbId: null,
			resource: 'Triage',
			operation: 'write',
			channel: 'rest',
		});
		if (accessResult) {
			if (!accessResult.allow) {
				return { status: user ? 403 : 401, data: { error: accessResult.reason || 'Access denied' } };
			}
		} else {
			if (!user) {
				return { status: 401, data: { error: 'Authentication required' } };
			}
			if (user.role !== 'team') {
				return { status: 403, data: { error: 'Team role required' } };
			}
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
		const processedBy = data.processedBy || user?.username || user?.id || 'unknown';
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
