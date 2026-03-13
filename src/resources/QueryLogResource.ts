/**
 * QueryLog Resource
 *
 * REST endpoint for search query analytics.
 * All operations require kbId query parameter for tenant scoping.
 *
 * Routes:
 *   GET /QueryLog/?kbId=..        — list recent query logs (team role required)
 *   GET /QueryLog/<id>?kbId=..    — get a single query log entry (team role required)
 */

import { checkAccess } from '../hooks.ts';

function getResourceClass(): any {
	return (globalThis as any).Resource;
}

function extractKbId(target?: any): string | null {
	return target?.get?.('kbId') || target?.kbId || null;
}

export class QueryLogResource extends getResourceClass() {
	static loadAsInstance = false;

	/**
	 * GET /QueryLog/?kbId=.. — list query logs, optionally filtered.
	 * GET /QueryLog/<id>?kbId=.. — get a single query log entry.
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
			resource: 'QueryLog',
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

		const id = this.getId();
		if (id) {
			const entry = await databases.kb.QueryLog.get(String(id));
			if (!entry || (entry as any).kbId !== kbId) {
				return { status: 404, data: { error: 'Query log entry not found' } };
			}
			return entry;
		}

		// List mode: support optional limit and query filter
		const limitParam = target?.get?.('limit') || target?.limit;
		const queryFilter = target?.get?.('query') || target?.query;
		const limit = limitParam ? parseInt(String(limitParam), 10) : 50;

		const conditions: Array<{
			attribute: string;
			comparator: string;
			value: unknown;
		}> = [{ attribute: 'kbId', comparator: 'equals', value: kbId }];
		if (queryFilter) {
			conditions.push({
				attribute: 'query',
				comparator: 'contains',
				value: String(queryFilter),
			});
		}

		const results: Record<string, unknown>[] = [];
		for await (const item of databases.kb.QueryLog.search({
			conditions,
			limit,
		})) {
			results.push(item);
		}

		return results;
	}
}
