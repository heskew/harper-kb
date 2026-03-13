/**
 * harper-kb — Type Definitions
 *
 * TypeScript interfaces for all table records, search parameters,
 * and Harper global type declarations.
 */

// ============================================================================
// Applicability Scope
// ============================================================================

/**
 * Describes what environment/configuration a knowledge entry applies to.
 * Stored on KnowledgeEntry.appliesTo.
 *
 * Generic key-value pairs — each KB defines its own dimensions.
 * Values can be exact strings or semver ranges (e.g., ">=2.0").
 *
 * Examples:
 *   { product: ">=4.6.0", platform: "linux" }
 *   { tier: "enterprise", region: "us-east" }
 */
export type ApplicabilityScope = Record<string, string>;

/**
 * External documentation or resource link.
 * Stored on KnowledgeEntry.references.
 */
export interface Reference {
	/** URL to the documentation or resource */
	url: string;
	/** Human-readable title for the link */
	title: string;
}

/**
 * Caller's context for search filtering — same shape as ApplicabilityScope.
 * Used to boost or demote results based on the caller's environment.
 *
 * Generic key-value pairs matching the KB's context dimensions.
 */
export type ApplicabilityContext = Record<string, string>;

// ============================================================================
// Table Record Interfaces
// ============================================================================

/**
 * Knowledge base registry record — one per tenant.
 * Stored in tables.KnowledgeBase.
 */
export interface KnowledgeBase {
	/** Knowledge base identifier (e.g., "acme-eng") */
	id: string;
	/** Display name */
	name: string;
	/** Description of this knowledge base */
	description?: string;
	/** Per-KB settings (embedding model, search defaults, etc.) */
	settings?: Record<string, unknown>;
	/** Username of who created this KB */
	createdBy?: string;
	createdAt?: Date;
	updatedAt?: Date;
}

/**
 * Data for creating a new knowledge base.
 */
export interface KnowledgeBaseInput {
	id: string;
	name: string;
	description?: string;
	settings?: Record<string, unknown>;
	createdBy?: string;
}

/**
 * Data for partial updates to an existing knowledge base.
 */
export interface KnowledgeBaseUpdate {
	name?: string;
	description?: string;
	settings?: Record<string, unknown>;
}

/**
 * Core knowledge base entry with vector embedding for semantic search.
 * Stored in tables.KnowledgeEntry.
 */
export interface KnowledgeEntry {
	id: string;
	/** Knowledge base identifier for multi-tenant scoping */
	kbId: string;
	title: string;
	content: string;
	tags: string[];
	appliesTo?: ApplicabilityScope;
	source?: string;
	sourceUrl?: string;
	references?: Reference[];
	/** "verified", "reviewed", or "ai-generated" */
	confidence: string;
	addedBy?: string;
	reviewedBy?: string;
	embedding?: number[];
	supersedesId?: string;
	supersededById?: string;
	siblingIds?: string[];
	relatedIds?: string[];
	metadata?: Record<string, unknown>;
	deprecated?: boolean;
	createdAt?: Date;
	updatedAt?: Date;
}

/**
 * Data for creating or updating a knowledge entry.
 * All fields except id are optional for updates.
 */
export interface KnowledgeEntryInput {
	id?: string;
	/** Knowledge base identifier for multi-tenant scoping */
	kbId: string;
	title: string;
	content: string;
	tags?: string[];
	appliesTo?: ApplicabilityScope;
	source?: string;
	sourceUrl?: string;
	references?: Reference[];
	confidence?: string;
	addedBy?: string;
	reviewedBy?: string;
	metadata?: Record<string, unknown>;
	deprecated?: boolean;
}

/**
 * Data for partial updates to an existing knowledge entry.
 */
export interface KnowledgeEntryUpdate {
	title?: string;
	content?: string;
	tags?: string[];
	appliesTo?: ApplicabilityScope;
	source?: string;
	sourceUrl?: string;
	references?: Reference[];
	confidence?: string;
	addedBy?: string;
	reviewedBy?: string;
	metadata?: Record<string, unknown>;
	deprecated?: boolean;
}

/**
 * Triage item for webhook intake queue.
 * 7-day TTL. Stored in tables.TriageItem.
 */
export interface TriageItem {
	id: string;
	/** Knowledge base identifier for multi-tenant scoping */
	kbId: string;
	source: string;
	sourceId?: string;
	rawPayload?: unknown;
	summary?: string;
	/** "pending", "processing", "accepted", or "dismissed" */
	status: string;
	matchedEntryId?: string;
	draftEntryId?: string;
	action?: string;
	processedBy?: string;
	createdAt?: Date;
	processedAt?: Date;
}

/**
 * Tag metadata with usage count.
 * Tag name serves as the ID. Stored in tables.KnowledgeTag.
 */
export interface KnowledgeTag {
	/** Tag name (also serves as primary key) */
	id: string;
	/** Knowledge base identifier for multi-tenant scoping */
	kbId: string;
	description?: string;
	entryCount: number;
}

/**
 * Search query analytics log entry.
 * 30-day TTL. Stored in tables.QueryLog.
 */
export interface QueryLog {
	id: string;
	/** Knowledge base identifier for multi-tenant scoping */
	kbId: string;
	query: string;
	context?: ApplicabilityContext;
	source?: string;
	resultCount: number;
	topResultId?: string;
	createdAt?: Date;
}

/**
 * API key for webhooks and service accounts.
 * Stored in tables.ServiceKey.
 */
export interface ServiceKey {
	id: string;
	/** Knowledge base identifier for multi-tenant scoping */
	kbId: string;
	name: string;
	keyHash: string;
	/** "service_account" or "ai_agent" */
	role: string;
	permissions?: Record<string, unknown>;
	createdBy?: string;
	createdAt?: Date;
	lastUsedAt?: Date;
}

/**
 * Edit history record for a knowledge entry.
 * Append-only audit log. Stored in tables.KnowledgeEntryEdit.
 */
export interface KnowledgeEntryEdit {
	id: string;
	/** Knowledge base identifier for multi-tenant scoping */
	kbId: string;
	/** ID of the knowledge entry that was edited */
	entryId: string;
	/** Username of who made the edit */
	editedBy: string;
	/** Brief description of what changed and why */
	editSummary?: string;
	/** Snapshot of the entry before this edit */
	previousSnapshot: Record<string, unknown>;
	/** List of field names that were changed */
	changedFields: string[];
	createdAt?: Date;
}

// ============================================================================
// Search Types
// ============================================================================

/**
 * Parameters for searching the knowledge base.
 */
export interface SearchParams {
	/** Knowledge base identifier for multi-tenant scoping */
	kbId: string;
	/** Search query string */
	query: string;
	/** Filter by tags */
	tags?: string[];
	/** Maximum number of results */
	limit?: number;
	/** Caller's environment context for applicability filtering */
	context?: ApplicabilityContext;
	/** Search mode: keyword, semantic, or hybrid (default) */
	mode?: 'keyword' | 'semantic' | 'hybrid';
}

/**
 * A search result extends a knowledge entry with relevance scoring.
 */
export interface SearchResult extends KnowledgeEntry {
	/** Relevance score (higher is better) */
	score: number;
	/** How this result was matched: "keyword", "semantic", or "hybrid" */
	matchType: string;
}

// ============================================================================
// Triage Types
// ============================================================================

/** Action to take on a triage item */
export type TriageAction = 'accepted' | 'dismissed' | 'linked';

/** Options for processing a triage item */
export interface TriageProcessOptions {
	/** Entry data to create when accepting */
	entryData?: KnowledgeEntryInput;
	/** Existing entry ID to link to */
	linkedEntryId?: string;
}

// ============================================================================
// Plugin Configuration
// ============================================================================

/**
 * Webhook endpoint — one per KB+provider combination.
 * id = SHA-256 hash of the secret token. Stored in tables.WebhookEndpoint.
 */
export interface WebhookEndpoint {
	/** SHA-256 hash of the secret (used as primary key for O(1) lookup) */
	id: string;
	/** Knowledge base identifier for multi-tenant scoping */
	kbId: string;
	/** Webhook provider (e.g., "github") */
	provider: string;
	/** Human-friendly label (e.g., "owner/repo") */
	label?: string;
	/** Username of who created this endpoint */
	createdBy?: string;
	createdAt?: Date;
}

/**
 * Plugin configuration options (from parent's config.yaml).
 */
export interface KnowledgePluginConfig {
	/** Embedding model name (default: "nomic-embed-text") */
	embeddingModel?: string;
	/** Preferred embedding backend: "gguf", "onnx", or "llama-cpp" (default: tries each in order) */
	embeddingBackend?: 'gguf' | 'onnx' | 'llama-cpp';
}

// ============================================================================
// Harper Global Type Declarations
// ============================================================================

/**
 * Logger interface matching Harper's component logger.
 */
export interface Logger {
	info?: (message: string, ...args: unknown[]) => void;
	error?: (message: string, ...args: unknown[]) => void;
	warn?: (message: string, ...args: unknown[]) => void;
	debug?: (message: string, ...args: unknown[]) => void;
}

/**
 * Harper table search query.
 */
export interface TableSearchQuery {
	conditions?: TableCondition[];
	sort?: TableSort;
	limit?: number;
	offset?: number;
}

export interface TableCondition {
	attribute: string;
	comparator: string;
	value: unknown;
}

export interface TableSort {
	attribute: string;
	descending?: boolean;
	/** Target vector for HNSW nearest-neighbor search */
	target?: number[];
}

/**
 * Harper table instance — methods available on each table global.
 */
export interface Table {
	get(id: string): Promise<Record<string, unknown> | null>;
	put(record: Record<string, unknown>): Promise<void>;
	delete(id: string): Promise<void>;
	search(query: TableSearchQuery): AsyncIterable<Record<string, unknown>>;
}

/**
 * Harper Scope passed to handleApplication for sub-component plugins.
 */
export interface Scope {
	directory: string;
	logger: Logger;
	resources: {
		set(name: string, resource: unknown): void;
	};
	server: {
		http?: (
			handler: (request: HarperRequest, next: (req: HarperRequest) => Promise<unknown>) => Promise<unknown>,
			options?: { runFirst?: boolean }
		) => void;
	};
	options: {
		get(keys: string[]): unknown;
		getAll(): Record<string, unknown>;
		on(event: string, handler: (...args: unknown[]) => void): void;
	};
	on(event: string, handler: (...args: unknown[]) => void): void;
}

/**
 * Harper HTTP request object.
 */
export interface HarperRequest {
	method?: string;
	pathname?: string;
	url?: string;
	headers?: Record<string, string | string[] | undefined>;
	body?: unknown;
	session?: Record<string, unknown>;
	[key: string]: unknown;
}

/**
 * Augment the global scope with Harper's runtime globals.
 * These are available at runtime but not at compile time.
 */
declare global {
	const databases: {
		kb: {
			KnowledgeBase: Table;
			KnowledgeEntry: Table;
			TriageItem: Table;
			KnowledgeTag: Table;
			QueryLog: Table;
			ServiceKey: Table;
			OAuthClient: Table;
			OAuthCode: Table;
			OAuthRefreshToken: Table;
			OAuthSigningKey: Table;
			WebhookEndpoint: Table;
			WebhookDelivery: Table;
			KnowledgeEntryEdit: Table;
		};
	};
	const logger: Logger;
}
