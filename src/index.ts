/**
 * harper-kb — Harper Knowledge Base Plugin
 *
 * Sub-component plugin that provides a knowledge base with vector search,
 * triage queue, and MCP server integration. Loaded by a parent application
 * via `package:` in the parent's config.yaml.
 *
 * Harper calls handleApplication(scope) on each worker thread.
 */

import { initEmbeddingModel, dispose as disposeEmbeddings } from './core/embeddings.ts';
import { KnowledgeBaseResource } from './resources/KnowledgeBaseResource.ts';
import { KnowledgeEntryResource } from './resources/KnowledgeEntryResource.ts';
import { TriageResource } from './resources/TriageResource.ts';
import { TagResource } from './resources/TagResource.ts';
import { QueryLogResource } from './resources/QueryLogResource.ts';
import { ServiceKeyResource } from './resources/ServiceKeyResource.ts';
import { WebhookEndpointResource } from './resources/WebhookEndpointResource.ts';
import { HistoryResource } from './resources/HistoryResource.ts';
import { MeResource } from './resources/MeResource.ts';
import { createMcpMiddleware } from './mcp/server.ts';
import { createWebhookMiddleware } from './webhooks/middleware.ts';
import { initOAuth } from './oauth/init.ts';
import type { Scope, KnowledgePluginConfig } from './types.ts';

// Re-export core modules for external use
export {
	createKnowledgeBase,
	getKnowledgeBase,
	updateKnowledgeBase,
	deleteKnowledgeBase,
	listKnowledgeBases,
} from './core/knowledge-base.ts';
export {
	createEntry,
	getEntry,
	updateEntry,
	deprecateEntry,
	linkSupersedes,
	linkSiblings,
	linkRelated,
} from './core/entries.ts';
export { search, filterByApplicability } from './core/search.ts';
export { logEdit, getHistory } from './core/history.ts';
export { listTags, syncTags } from './core/tags.ts';
export { submitTriage, processTriage, listPending, dismissTriage, findBySourceId } from './core/triage.ts';
export { generateEmbedding, initEmbeddingModel, dispose as disposeEmbeddings } from './core/embeddings.ts';
export { createWebhookEndpoint, listWebhookEndpoints, deleteWebhookEndpoint } from './core/webhook-endpoints.ts';
export { registerHooks } from './hooks.ts';

// Re-export types
export type {
	KnowledgeBase,
	KnowledgeBaseInput,
	KnowledgeBaseUpdate,
	KnowledgeEntry,
	KnowledgeEntryInput,
	KnowledgeEntryUpdate,
	KnowledgeEntryEdit,
	TriageItem,
	KnowledgeTag,
	QueryLog,
	ServiceKey,
	SearchParams,
	SearchResult,
	Reference,
	ApplicabilityScope,
	ApplicabilityContext,
	TriageAction,
	TriageProcessOptions,
	WebhookEndpoint,
	KnowledgePluginConfig,
} from './types.ts';
export type { KnowledgeHooks, AccessCheckContext, AccessCheckResult } from './hooks.ts';
export type { ValidatedCaller } from './oauth/validate.ts';

/**
 * Plugin entry point — called by Harper on each worker thread.
 */
export async function handleApplication(scope: Scope): Promise<void> {
	const scopeLogger = scope.logger;

	scopeLogger?.info?.('Knowledge base plugin initializing...');

	// Read plugin configuration
	const rawOptions = (scope.options.getAll() || {}) as KnowledgePluginConfig;
	const embeddingModel = rawOptions.embeddingModel || 'nomic-embed-text';
	const embeddingBackend = rawOptions.embeddingBackend;

	// Initialize the embedding model in the background (downloads on first run).
	// Don't await — the download can take minutes and would exceed Harper's
	// 30-second handleApplication timeout. Semantic search degrades gracefully
	// to keyword-only mode until the model is ready.
	initEmbeddingModel({ embeddingModel, embeddingBackend, componentDir: scope.directory }).then(
		() => scopeLogger?.info?.(`Embedding model "${embeddingModel}" loaded`),
		(error) =>
			scopeLogger?.error?.(
				'Failed to initialize embedding model — semantic search will be unavailable:',
				(error as Error).message
			)
	);

	// Initialize OAuth (signing keys, middleware)
	await initOAuth(scope);

	// Register REST Resource classes
	scope.resources.set('KnowledgeBase', KnowledgeBaseResource);
	scope.resources.set('Knowledge', KnowledgeEntryResource);
	scope.resources.set('Triage', TriageResource);
	scope.resources.set('KnowledgeTag', TagResource);
	scope.resources.set('QueryLog', QueryLogResource);
	scope.resources.set('ServiceKey', ServiceKeyResource);
	scope.resources.set('WebhookEndpoint', WebhookEndpointResource);
	scope.resources.set('History', HistoryResource);
	scope.resources.set('me', MeResource);

	// Register webhook intake middleware (before MCP so /webhooks/* is handled first)
	scope.server.http?.(createWebhookMiddleware(scope));

	// Register MCP endpoint middleware (runFirst so it executes before Harper's auth layer)
	scope.server.http?.(createMcpMiddleware(), { runFirst: true });

	scopeLogger?.info?.('Knowledge base resources, OAuth, and MCP endpoint registered');

	// Watch for configuration changes
	scope.options.on('change', (_key: unknown, _value: unknown, _config: unknown) => {
		scopeLogger?.debug?.('Knowledge base configuration changed');
		// Future: re-configure embedding model or other settings as needed
	});

	// Clean up on scope close
	scope.on('close', () => {
		scopeLogger?.info?.('Knowledge base plugin shutting down');
		disposeEmbeddings().catch((error) => {
			scopeLogger?.error?.('Error disposing embedding model:', (error as Error).message);
		});
	});

	scopeLogger?.info?.('Knowledge base plugin initialized');
}
