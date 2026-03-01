/**
 * MCP Tool Definitions
 *
 * Static array of tool definitions with JSON Schema input schemas
 * and handler functions. Each handler receives (args, caller) and
 * returns MCP tool content.
 *
 * The kbId is implicit — it comes from the caller (extracted from the URL
 * path /mcp/<kbId>), so tools don't need it as an input parameter.
 */

import { search } from '../core/search.ts';
import {
	createEntry,
	getEntry,
	updateEntry,
	stripEmbedding,
	reindexEmbeddings,
	linkRelated,
	linkSiblings,
} from '../core/entries.ts';
import { listTags } from '../core/tags.ts';
import { submitTriage } from '../core/triage.ts';
import { generateEmbedding } from '../core/embeddings.ts';
import { getHistory } from '../core/history.ts';
import type { KnowledgeEntry, SearchResult } from '../types.ts';
import type { ValidatedCaller } from '../oauth/validate.ts';

// ============================================================================
// Types
// ============================================================================

export interface ToolContent {
	content: Array<{ type: 'text'; text: string }>;
	isError?: true;
}

export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	handler: (args: Record<string, unknown>, caller: ValidatedCaller) => Promise<ToolContent>;
}

// ============================================================================
// Helpers
// ============================================================================

function jsonContent(data: unknown): ToolContent {
	return {
		content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
	};
}

function errorContent(message: string): ToolContent {
	return {
		content: [{ type: 'text' as const, text: message }],
		isError: true,
	};
}

function requireWrite(caller: ValidatedCaller, action: string): ToolContent | null {
	if (!caller.scopes.includes('mcp:write')) {
		return errorContent(`Write access required to ${action}.`);
	}
	return null;
}

// ============================================================================
// Tool Definitions
// ============================================================================

export const tools: ToolDefinition[] = [
	// =========================================================================
	// 1. knowledge_search — Search the knowledge base
	// =========================================================================
	{
		name: 'knowledge_search',
		description:
			'Search the knowledge base using keyword, semantic, or hybrid search. ' +
			'Returns scored results sorted by relevance. Provide optional environment ' +
			'context to boost results matching your setup.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Search query string' },
				tags: {
					type: 'array',
					items: { type: 'string' },
					description: 'Filter results by tags',
				},
				limit: {
					type: 'integer',
					minimum: 1,
					maximum: 50,
					description: 'Maximum number of results (default 10)',
				},
				context: {
					type: 'object',
					additionalProperties: { type: 'string' },
					description:
						"Caller's environment context as key-value pairs for applicability filtering. " +
						"Values can be exact strings or semver ranges (e.g., { product: '>=2.0', tier: 'enterprise' }).",
				},
			},
			required: ['query'],
		},
		handler: async (args, caller) => {
			try {
				const results = await search({
					kbId: caller.kbId,
					query: args.query as string,
					tags: args.tags as string[] | undefined,
					limit: args.limit as number | undefined,
					context: args.context as any,
				});
				const cleaned = results.map(stripEmbedding);
				return jsonContent({
					resultCount: cleaned.length,
					results: cleaned,
				});
			} catch (error) {
				logger?.error?.('knowledge_search failed:', (error as Error).message);
				return errorContent('Search failed. Please try again.');
			}
		},
	},

	// =========================================================================
	// 2. knowledge_add — Add a new knowledge entry
	// =========================================================================
	{
		name: 'knowledge_add',
		description:
			'Add a new entry to the knowledge base. Keep entries focused and concise — ' +
			'one topic per entry. Use the knowledge_link tool to cross-reference related entries ' +
			'rather than duplicating content. Use references for links to external documentation. ' +
			'Entries added via MCP are automatically tagged with confidence "ai-generated".',
		inputSchema: {
			type: 'object',
			properties: {
				title: {
					type: 'string',
					maxLength: 500,
					description: 'Entry title — concise summary of the knowledge',
				},
				content: {
					type: 'string',
					maxLength: 100000,
					description: 'Full content of the knowledge entry (Markdown supported)',
				},
				tags: {
					type: 'array',
					items: { type: 'string', maxLength: 100 },
					maxItems: 50,
					description: 'Tags for categorization (e.g., ["plugins", "config"])',
				},
				source: {
					type: 'string',
					maxLength: 200,
					description: 'Source identifier (e.g., "github-issue", "docs", "slack")',
				},
				sourceUrl: {
					type: 'string',
					maxLength: 2000,
					description: 'URL to the original source',
				},
				references: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							url: {
								type: 'string',
								maxLength: 2000,
								description: 'URL to the documentation or resource',
							},
							title: {
								type: 'string',
								maxLength: 500,
								description: 'Human-readable title for the link',
							},
						},
						required: ['url', 'title'],
					},
					maxItems: 20,
					description: 'External documentation links (docs pages, tutorials, API references)',
				},
				appliesTo: {
					type: 'object',
					additionalProperties: { type: 'string' },
					description:
						'Applicability scope — what environments this entry applies to. ' +
						"Use semver ranges for version fields (e.g., { product: '>=2.0', platform: 'linux' }).",
				},
			},
			required: ['title', 'content', 'tags'],
		},
		handler: async (args, caller) => {
			const denied = requireWrite(caller, 'add entries');
			if (denied) return denied;
			try {
				const entry = await createEntry({
					kbId: caller.kbId,
					title: args.title as string,
					content: args.content as string,
					tags: args.tags as string[],
					source: args.source as string | undefined,
					sourceUrl: args.sourceUrl as string | undefined,
					references: args.references as any,
					appliesTo: args.appliesTo as any,
					confidence: 'ai-generated',
				});
				return jsonContent({
					message: 'Knowledge entry created successfully',
					entry: stripEmbedding(entry),
				});
			} catch (error) {
				logger?.error?.('knowledge_add failed:', (error as Error).message);
				return errorContent('Failed to create entry. Please try again.');
			}
		},
	},

	// =========================================================================
	// 3. knowledge_get — Get a knowledge entry by ID
	// =========================================================================
	{
		name: 'knowledge_get',
		description:
			'Get a single knowledge entry by ID. If the entry has relationships ' +
			'(supersedes, superseded by, siblings, related), the linked entries ' +
			'are also fetched and included in the response.',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', description: 'The knowledge entry ID' },
			},
			required: ['id'],
		},
		handler: async (args, caller) => {
			try {
				const id = args.id as string;
				const entry = await getEntry(id);
				if (!entry || entry.kbId !== caller.kbId) {
					return errorContent(`Knowledge entry not found: ${id}`);
				}

				const result: Record<string, unknown> = {
					entry: stripEmbedding(entry),
				};

				const relationships: Record<string, unknown> = {};

				if (entry.supersedesId) {
					const supersedes = await getEntry(entry.supersedesId);
					if (supersedes) {
						relationships.supersedes = stripEmbedding(supersedes);
					}
				}

				if (entry.supersededById) {
					const supersededBy = await getEntry(entry.supersededById);
					if (supersededBy) {
						relationships.supersededBy = stripEmbedding(supersededBy);
					}
				}

				if (entry.siblingIds && entry.siblingIds.length > 0) {
					const siblings: Array<Omit<KnowledgeEntry, 'embedding'>> = [];
					for (const siblingId of entry.siblingIds) {
						const sibling = await getEntry(siblingId);
						if (sibling) {
							siblings.push(stripEmbedding(sibling));
						}
					}
					if (siblings.length > 0) {
						relationships.siblings = siblings;
					}
				}

				if (entry.relatedIds && entry.relatedIds.length > 0) {
					const related: Array<Omit<KnowledgeEntry, 'embedding'>> = [];
					for (const relatedId of entry.relatedIds) {
						const relatedEntry = await getEntry(relatedId);
						if (relatedEntry) {
							related.push(stripEmbedding(relatedEntry));
						}
					}
					if (related.length > 0) {
						relationships.related = related;
					}
				}

				if (Object.keys(relationships).length > 0) {
					result.relationships = relationships;
				}

				return jsonContent(result);
			} catch (error) {
				logger?.error?.('knowledge_get failed:', (error as Error).message);
				return errorContent('Failed to get entry. Please try again.');
			}
		},
	},

	// =========================================================================
	// 4. knowledge_related — Find entries related to a given entry
	// =========================================================================
	{
		name: 'knowledge_related',
		description:
			'Find knowledge entries related to a given entry. Combines explicit ' +
			'relationships (siblings, related, supersedes chain) with semantic ' +
			"similarity search using the entry's embedding.",
		inputSchema: {
			type: 'object',
			properties: {
				id: {
					type: 'string',
					description: 'The knowledge entry ID to find related entries for',
				},
				limit: {
					type: 'integer',
					minimum: 1,
					maximum: 50,
					description: 'Maximum number of results (default 10)',
				},
			},
			required: ['id'],
		},
		handler: async (args, caller) => {
			const id = args.id as string;
			const maxResults = (args.limit as number) ?? 10;

			try {
				const entry = await getEntry(id);
				if (!entry || entry.kbId !== caller.kbId) {
					return errorContent(`Knowledge entry not found: ${id}`);
				}

				const relatedMap = new Map<string, { entry: Omit<KnowledgeEntry, 'embedding'>; relationship: string }>();

				if (entry.supersedesId) {
					const supersedes = await getEntry(entry.supersedesId);
					if (supersedes) {
						relatedMap.set(supersedes.id, {
							entry: stripEmbedding(supersedes),
							relationship: 'supersedes',
						});
					}
				}

				if (entry.supersededById) {
					const supersededBy = await getEntry(entry.supersededById);
					if (supersededBy) {
						relatedMap.set(supersededBy.id, {
							entry: stripEmbedding(supersededBy),
							relationship: 'superseded_by',
						});
					}
				}

				if (entry.siblingIds) {
					for (const siblingId of entry.siblingIds) {
						if (!relatedMap.has(siblingId)) {
							const sibling = await getEntry(siblingId);
							if (sibling) {
								relatedMap.set(sibling.id, {
									entry: stripEmbedding(sibling),
									relationship: 'sibling',
								});
							}
						}
					}
				}

				if (entry.relatedIds) {
					for (const relatedId of entry.relatedIds) {
						if (!relatedMap.has(relatedId)) {
							const relatedEntry = await getEntry(relatedId);
							if (relatedEntry) {
								relatedMap.set(relatedEntry.id, {
									entry: stripEmbedding(relatedEntry),
									relationship: 'related',
								});
							}
						}
					}
				}

				// Semantic similarity search using entry content
				let semanticResults: SearchResult[] = [];
				try {
					const queryText = `${entry.title}\n\n${entry.content}`;
					const embedding = await generateEmbedding(queryText);

					const searchResults: Record<string, unknown>[] = [];
					for await (const item of databases.kb.KnowledgeEntry.search({
						conditions: [{ attribute: 'kbId', comparator: 'equals', value: caller.kbId }],
						sort: { attribute: 'embedding', target: embedding },
						limit: maxResults + 10,
					})) {
						searchResults.push(item);
					}

					semanticResults = searchResults
						.map((r) => r as unknown as SearchResult)
						.filter((r) => r.id !== id && !r.deprecated);
				} catch {
					// Embedding model may not be available
				}

				for (const result of semanticResults) {
					if (!relatedMap.has(result.id) && relatedMap.size < maxResults) {
						relatedMap.set(result.id, {
							entry: stripEmbedding(result),
							relationship: 'similar',
						});
					}
				}

				const results = Array.from(relatedMap.values()).slice(0, maxResults);

				return jsonContent({
					entryId: id,
					entryTitle: entry.title,
					relatedCount: results.length,
					related: results,
				});
			} catch (error) {
				logger?.error?.('knowledge_related failed:', (error as Error).message);
				return errorContent('Failed to find related entries. Please try again.');
			}
		},
	},

	// =========================================================================
	// 5. knowledge_list_tags — List all knowledge tags
	// =========================================================================
	{
		name: 'knowledge_list_tags',
		description:
			'List all tags in the knowledge base with their entry counts. ' +
			'Useful for discovering available categories before searching.',
		inputSchema: {
			type: 'object',
			properties: {},
		},
		handler: async (_args, caller) => {
			try {
				const tags = await listTags(caller.kbId);
				return jsonContent({
					tagCount: tags.length,
					tags,
				});
			} catch (error) {
				logger?.error?.('knowledge_list_tags failed:', (error as Error).message);
				return errorContent('Failed to list tags. Please try again.');
			}
		},
	},

	// =========================================================================
	// 6. knowledge_triage — Submit an item to the triage queue
	// =========================================================================
	{
		name: 'knowledge_triage',
		description:
			'Submit a new item to the knowledge triage queue for review. ' +
			'Use this when you encounter information that should potentially ' +
			'be added to the knowledge base but needs human review first.',
		inputSchema: {
			type: 'object',
			properties: {
				source: {
					type: 'string',
					description: 'Source identifier (e.g., "claude-code", "github-issue", "slack")',
				},
				summary: {
					type: 'string',
					description: 'Brief summary of the knowledge to triage',
				},
				payload: {
					type: 'object',
					additionalProperties: true,
					description: 'Additional payload data from the source',
				},
			},
			required: ['source', 'summary'],
		},
		handler: async (args, caller) => {
			const denied = requireWrite(caller, 'submit triage items');
			if (denied) return denied;
			try {
				const item = await submitTriage(
					caller.kbId,
					args.source as string,
					args.summary as string,
					args.payload as Record<string, unknown> | undefined
				);
				return jsonContent({
					message: 'Triage item submitted successfully',
					item,
				});
			} catch (error) {
				logger?.error?.('knowledge_triage failed:', (error as Error).message);
				return errorContent('Failed to submit triage item. Please try again.');
			}
		},
	},

	// =========================================================================
	// 7. knowledge_update — Update an existing knowledge entry
	// =========================================================================
	{
		name: 'knowledge_update',
		description:
			'Update an existing knowledge entry. Only provide fields you want to change. ' +
			'Prefer keeping entries concise and using references/knowledge_link to connect ' +
			'to other entries and external docs rather than inlining everything. ' +
			'Edits are tracked in the history log with who made the change and why.',
		inputSchema: {
			type: 'object',
			properties: {
				id: {
					type: 'string',
					description: 'The knowledge entry ID to update',
				},
				title: {
					type: 'string',
					maxLength: 500,
					description: 'Updated title',
				},
				content: {
					type: 'string',
					maxLength: 100000,
					description: 'Updated content (Markdown supported)',
				},
				tags: {
					type: 'array',
					items: { type: 'string', maxLength: 100 },
					maxItems: 50,
					description: 'Updated tags',
				},
				source: {
					type: 'string',
					maxLength: 200,
					description: 'Updated source identifier',
				},
				sourceUrl: {
					type: 'string',
					maxLength: 2000,
					description: 'Updated source URL',
				},
				references: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							url: {
								type: 'string',
								maxLength: 2000,
								description: 'URL to the documentation or resource',
							},
							title: {
								type: 'string',
								maxLength: 500,
								description: 'Human-readable title for the link',
							},
						},
						required: ['url', 'title'],
					},
					maxItems: 20,
					description: 'Updated external documentation links',
				},
				confidence: {
					type: 'string',
					enum: ['ai-generated', 'reviewed', 'verified'],
					description: 'Updated confidence level',
				},
				appliesTo: {
					type: 'object',
					additionalProperties: { type: 'string' },
					description:
						'Updated applicability scope. ' +
						"Use semver ranges for version fields (e.g., { product: '>=2.0', platform: 'linux' }).",
				},
				deprecated: {
					type: 'boolean',
					description: 'Mark as deprecated',
				},
				editSummary: {
					type: 'string',
					maxLength: 1000,
					description: 'Brief description of what changed and why (for the edit log)',
				},
			},
			required: ['id'],
		},
		handler: async (args, caller) => {
			const denied = requireWrite(caller, 'update entries');
			if (denied) return denied;

			const id = args.id as string;
			const existing = await getEntry(id);
			if (!existing || existing.kbId !== caller.kbId) {
				return errorContent(`Knowledge entry not found: ${id}`);
			}

			const { id: _id, editSummary, ...updates } = args as Record<string, unknown>;
			if (updates.confidence && (updates.confidence as string) !== 'ai-generated') {
				delete updates.confidence;
			}

			try {
				const entry = await updateEntry(id, updates, {
					editedBy: caller.userId,
					editSummary: editSummary as string | undefined,
				});
				return jsonContent({
					message: 'Knowledge entry updated successfully',
					entry: stripEmbedding(entry),
				});
			} catch (error) {
				logger?.error?.('knowledge_update failed:', (error as Error).message);
				return errorContent('Failed to update entry. Please try again.');
			}
		},
	},

	// =========================================================================
	// 8. knowledge_history — Get edit history for an entry
	// =========================================================================
	{
		name: 'knowledge_history',
		description:
			'Get the edit history for a knowledge entry. Shows who changed what, ' +
			'when, and why — with snapshots of previous values for each changed field.',
		inputSchema: {
			type: 'object',
			properties: {
				id: {
					type: 'string',
					description: 'The knowledge entry ID to get history for',
				},
				limit: {
					type: 'integer',
					minimum: 1,
					maximum: 100,
					description: 'Maximum number of edits to return (default 50)',
				},
			},
			required: ['id'],
		},
		handler: async (args, caller) => {
			try {
				const id = args.id as string;
				const entry = await getEntry(id);
				if (!entry || entry.kbId !== caller.kbId) {
					return errorContent(`Knowledge entry not found: ${id}`);
				}

				const edits = await getHistory(id, args.limit as number | undefined);
				return jsonContent({
					entryId: id,
					entryTitle: entry.title,
					editCount: edits.length,
					edits,
				});
			} catch (error) {
				logger?.error?.('knowledge_history failed:', (error as Error).message);
				return errorContent('Failed to get edit history. Please try again.');
			}
		},
	},

	// =========================================================================
	// 9. knowledge_reindex — Backfill missing embeddings
	// =========================================================================
	{
		name: 'knowledge_reindex',
		description:
			'Reindex embeddings for all knowledge entries that are missing them. ' +
			'Use this after the embedding model becomes available on a deployment ' +
			'where entries were initially created without embeddings. ' +
			'Requires write access.',
		inputSchema: {
			type: 'object',
			properties: {},
		},
		handler: async (_args, caller) => {
			const denied = requireWrite(caller, 'reindex embeddings');
			if (denied) return denied;

			try {
				const result = await reindexEmbeddings(caller.kbId);
				return jsonContent({
					message: 'Embedding reindex complete',
					...result,
				});
			} catch (error) {
				logger?.error?.('knowledge_reindex failed:', (error as Error).message);
				return errorContent('Failed to reindex embeddings. Please try again.');
			}
		},
	},

	// =========================================================================
	// 10. knowledge_link — Manage relationships between entries
	// =========================================================================
	{
		name: 'knowledge_link',
		description:
			'Create relationships between knowledge entries. Use this to keep the knowledge ' +
			'base well-connected — link related entries instead of duplicating information. ' +
			"Supports 'related' (one-directional) and 'sibling' (multi-way) relationship types.",
		inputSchema: {
			type: 'object',
			properties: {
				type: {
					type: 'string',
					enum: ['related', 'sibling'],
					description:
						"Relationship type: 'related' adds a one-directional link (A -> B), " +
						"'sibling' creates multi-way links between all provided IDs",
				},
				ids: {
					type: 'array',
					items: { type: 'string' },
					minItems: 2,
					maxItems: 20,
					description:
						"Entry IDs to link. For 'related', the first ID is the source and " +
						'subsequent IDs are added as its related entries. ' +
						"For 'sibling', all entries are linked to each other.",
				},
			},
			required: ['type', 'ids'],
		},
		handler: async (args, caller) => {
			const denied = requireWrite(caller, 'manage relationships');
			if (denied) return denied;

			const ids = args.ids as string[];
			for (const entryId of ids) {
				const entry = await getEntry(entryId);
				if (!entry || entry.kbId !== caller.kbId) {
					return errorContent(`Knowledge entry not found: ${entryId}`);
				}
			}

			try {
				if ((args.type as string) === 'sibling') {
					await linkSiblings(ids);
					return jsonContent({
						message: `Linked ${ids.length} entries as siblings`,
						ids,
					});
				} else {
					const [sourceId, ...targetIds] = ids;
					for (const targetId of targetIds) {
						await linkRelated(sourceId, targetId);
					}
					return jsonContent({
						message: `Added ${targetIds.length} related link(s) to entry ${sourceId}`,
						sourceId,
						relatedIds: targetIds,
					});
				}
			} catch (error) {
				logger?.error?.('knowledge_link failed:', (error as Error).message);
				return errorContent('Failed to link entries. Please try again.');
			}
		},
	},
];
