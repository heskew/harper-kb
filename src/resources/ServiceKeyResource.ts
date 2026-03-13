/**
 * ServiceKey Resource
 *
 * REST endpoint for managing API keys for webhooks and service accounts.
 * All operations require team role and kbId for tenant scoping.
 *
 * Routes:
 *   GET    /ServiceKey/?kbId=..       — list all keys (team role, keyHash never returned)
 *   GET    /ServiceKey/<id>?kbId=..   — get a single key (team role, keyHash never returned)
 *   POST   /ServiceKey/?kbId=..       — create a new key (team role, returns plaintext key once)
 *   DELETE /ServiceKey/<id>?kbId=..   — delete a key (team role)
 */

import crypto from 'node:crypto';
import { checkAccess } from '../hooks.ts';

function getResourceClass(): any {
	return (globalThis as any).Resource;
}

function extractKbId(target?: any): string | null {
	return target?.get?.('kbId') || target?.kbId || null;
}

/**
 * Hash an API key using scrypt with the given salt.
 * Returns the hex-encoded hash.
 */
function hashKey(key: string, salt: string): string {
	return crypto.scryptSync(key, salt, 64).toString('hex');
}

/**
 * Strip keyHash from a service key record before returning to the client.
 */
function sanitizeKey(record: Record<string, unknown>): Record<string, unknown> {
	const { keyHash: _keyHash, ...safe } = record;
	return safe;
}

export class ServiceKeyResource extends getResourceClass() {
	static loadAsInstance = false;

	/**
	 * GET /ServiceKey/?kbId=.. — list all service keys (keyHash excluded).
	 * GET /ServiceKey/<id>?kbId=.. — get a single key (keyHash excluded).
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
			resource: 'ServiceKey',
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
			const record = await databases.kb.ServiceKey.get(String(id));
			if (!record || (record as any).kbId !== kbId) {
				return { status: 404, data: { error: 'Service key not found' } };
			}
			return sanitizeKey(record);
		}

		// List mode
		const limitParam = target?.get?.('limit') || target?.limit;
		const limit = limitParam ? parseInt(String(limitParam), 10) : 100;

		const results: Record<string, unknown>[] = [];
		for await (const item of databases.kb.ServiceKey.search({
			conditions: [{ attribute: 'kbId', comparator: 'equals', value: kbId }],
			limit,
		})) {
			results.push(sanitizeKey(item));
		}

		return results;
	}

	/**
	 * POST /ServiceKey/?kbId=.. — create a new API key.
	 * Default: team role required. Hook can override.
	 *
	 * Body: { name: string, role: "service_account" | "ai_agent", permissions?: object }
	 *
	 * Returns the plaintext key exactly once. It is never stored or retrievable again.
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
			resource: 'ServiceKey',
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

		if (!data?.name) {
			return { status: 400, data: { error: 'name is required' } };
		}
		if (!data?.role || (data.role !== 'service_account' && data.role !== 'ai_agent')) {
			return {
				status: 400,
				data: { error: 'role must be "service_account" or "ai_agent"' },
			};
		}

		// Generate a random API key and hash it
		const plaintextKey = crypto.randomBytes(32).toString('hex');
		const salt = crypto.randomBytes(16).toString('hex');
		const hash = hashKey(plaintextKey, salt);

		const id = crypto.randomUUID();
		const record: Record<string, unknown> = {
			id,
			kbId,
			name: data.name,
			keyHash: `${salt}:${hash}`,
			role: data.role,
			permissions: data.permissions || null,
			createdBy: user?.username || user?.id || 'unknown',
		};

		await databases.kb.ServiceKey.put(record);

		// Return the record without keyHash, plus the plaintext key (shown only once)
		return {
			...sanitizeKey(record),
			key: plaintextKey,
		};
	}

	/**
	 * DELETE /ServiceKey/<id>?kbId=.. — delete a service key.
	 * Default: team role required. Hook can override.
	 */
	async delete(target?: any) {
		const user = this.getCurrentUser();
		const id = this.getId();
		if (!id) {
			return { status: 400, data: { error: 'Service key ID required' } };
		}

		const kbId = extractKbId(target);
		if (!kbId) {
			return { status: 400, data: { error: 'kbId query parameter is required' } };
		}

		const accessResult = await checkAccess({
			user,
			kbId,
			resource: 'ServiceKey',
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

		const existing = await databases.kb.ServiceKey.get(String(id));
		if (!existing || (existing as any).kbId !== kbId) {
			return { status: 404, data: { error: 'Service key not found' } };
		}

		await databases.kb.ServiceKey.delete(String(id));
		return true;
	}
}
