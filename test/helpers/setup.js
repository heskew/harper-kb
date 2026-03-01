/**
 * Test Setup — Mock Harper Globals
 *
 * Provides in-memory mock implementations of Harper's runtime globals:
 * tables, Resource, and logger. Must be imported before any project modules.
 */

// Track per-instance Resource state using a WeakMap (avoids private field issues)
const _resourceIds = new WeakMap();
const _resourceContexts = new WeakMap();

/**
 * Create a mock table with in-memory Map storage.
 * Supports get, put, delete, and search (with conditions and limit).
 */
function createMockTable() {
	const store = new Map();
	return {
		get: async (id) => {
			const record = store.get(String(id));
			return record ? { ...record } : null;
		},
		put: async (record) => {
			store.set(String(record.id), { ...record });
		},
		delete: async (id) => {
			store.delete(String(id));
		},
		search: async function* (query) {
			const { conditions, sort: _sort, limit } = query || {};
			let results = Array.from(store.values());

			// Apply conditions filtering
			if (conditions && conditions.length > 0) {
				results = results.filter((record) => {
					return conditions.every((cond) => {
						const value = record[cond.attribute];
						switch (cond.comparator) {
							case 'equals':
								return value === cond.value;
							case 'contains':
								if (typeof value === 'string') {
									return value.toLowerCase().includes(String(cond.value).toLowerCase());
								}
								if (Array.isArray(value)) {
									return value.includes(cond.value);
								}
								return false;
							default:
								return true;
						}
					});
				});
			}

			// Apply limit
			const max = limit || results.length;
			for (let i = 0; i < Math.min(results.length, max); i++) {
				yield { ...results[i] };
			}
		},
		// Test helpers
		_clear: () => store.clear(),
		_store: store,
	};
}

// Set up global tables
globalThis.tables = {
	KnowledgeBase: createMockTable(),
	KnowledgeEntry: createMockTable(),
	TriageItem: createMockTable(),
	KnowledgeTag: createMockTable(),
	QueryLog: createMockTable(),
	ServiceKey: createMockTable(),
	KnowledgeEntryEdit: createMockTable(),
	OAuthClient: createMockTable(),
	OAuthCode: createMockTable(),
	OAuthRefreshToken: createMockTable(),
	OAuthSigningKey: createMockTable(),
	WebhookEndpoint: createMockTable(),
	WebhookDelivery: createMockTable(),
};

// Alias as databases.kb (source code uses databases.kb.TableName)
globalThis.databases = { kb: globalThis.tables };

// Set up mock Resource base class
// Uses WeakMap for instance state so subclass inheritance works correctly
globalThis.Resource = class Resource {
	constructor() {
		_resourceIds.set(this, null);
		_resourceContexts.set(this, { user: null });
	}

	getId() {
		return _resourceIds.get(this);
	}

	getCurrentUser() {
		const ctx = _resourceContexts.get(this);
		return ctx?.user || undefined;
	}

	getContext() {
		return _resourceContexts.get(this);
	}

	// Test helpers to set per-instance state
	_setId(id) {
		_resourceIds.set(this, id);
	}

	_setContext(ctx) {
		_resourceContexts.set(this, ctx);
	}
};

// Set up silent logger
globalThis.logger = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
};

/**
 * Clear all data from all mock tables.
 * Call in beforeEach to ensure test isolation.
 */
export function clearAllTables() {
	for (const table of Object.values(globalThis.tables)) {
		table._clear();
	}
}
