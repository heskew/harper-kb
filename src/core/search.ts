/**
 * Knowledge Base Search
 *
 * Supports keyword, semantic (vector), and hybrid search modes.
 * Applies applicability context filtering to boost/demote results.
 * Logs all queries to the QueryLog table for analytics.
 *
 * All queries are scoped by kbId for multi-tenant isolation.
 */

import crypto from 'node:crypto';
import { generateEmbedding } from './embeddings.ts';
import type { SearchParams, SearchResult, KnowledgeEntry, ApplicabilityContext } from '../types.ts';

/** Default number of results to return */
const DEFAULT_LIMIT = 10;

/**
 * Convert a Harper database record to a plain SearchResult object.
 *
 * Harper records use non-enumerable properties, so object spread
 * ({...record}) produces an empty object. We must explicitly read
 * each field.
 */
function toSearchResult(record: unknown, score: number, matchType: string): SearchResult {
	const entry = record as KnowledgeEntry;
	return {
		id: entry.id,
		kbId: entry.kbId,
		title: entry.title,
		content: entry.content,
		tags: entry.tags,
		appliesTo: entry.appliesTo,
		source: entry.source,
		sourceUrl: entry.sourceUrl,
		references: entry.references,
		confidence: entry.confidence,
		addedBy: entry.addedBy,
		reviewedBy: entry.reviewedBy,
		supersedesId: entry.supersedesId,
		supersededById: entry.supersededById,
		siblingIds: entry.siblingIds,
		relatedIds: entry.relatedIds,
		metadata: entry.metadata,
		deprecated: entry.deprecated,
		createdAt: entry.createdAt,
		updatedAt: entry.updatedAt,
		score,
		matchType,
	};
}

/** Score boost factor for applicability matches */
const APPLICABILITY_BOOST = 1.2;

/** Score penalty factor for applicability mismatches */
const APPLICABILITY_PENALTY = 0.8;

/**
 * Search the knowledge base.
 *
 * @param params - Search parameters including kbId, query, mode, tags, limit, context
 * @returns Scored and sorted search results
 */
export async function search(params: SearchParams): Promise<SearchResult[]> {
	const { kbId, query, tags, limit = DEFAULT_LIMIT, context, mode = 'hybrid' } = params;

	let results: SearchResult[];

	switch (mode) {
		case 'keyword':
			results = await keywordSearch(kbId, query, tags, limit);
			break;
		case 'semantic':
			results = await semanticSearch(kbId, query, limit);
			break;
		case 'hybrid':
		default:
			results = await hybridSearch(kbId, query, tags, limit);
			break;
	}

	// Apply applicability filtering (boost/demote based on context)
	if (context) {
		results = filterByApplicability(results, context);
	}

	// Re-sort by score after applicability adjustments
	results.sort((a, b) => b.score - a.score);

	// Trim to limit
	results = results.slice(0, limit);

	// Log the search query for analytics
	await logQuery(kbId, query, context, results);

	return results;
}

/**
 * Perform keyword-based search using Harper's condition-based search.
 */
async function keywordSearch(
	kbId: string,
	query: string,
	tags?: string[],
	limit: number = DEFAULT_LIMIT
): Promise<SearchResult[]> {
	// Run the title search
	const titleResults = await collectResults(
		databases.kb.KnowledgeEntry.search({
			conditions: [
				{ attribute: 'kbId', comparator: 'equals', value: kbId },
				{ attribute: 'title', comparator: 'contains', value: query },
				{ attribute: 'deprecated', comparator: 'equals', value: false },
			],
			limit: limit * 2, // Fetch extra for merging
		})
	);

	// Also search by content
	const contentResults = await collectResults(
		databases.kb.KnowledgeEntry.search({
			conditions: [
				{ attribute: 'kbId', comparator: 'equals', value: kbId },
				{ attribute: 'content', comparator: 'contains', value: query },
				{ attribute: 'deprecated', comparator: 'equals', value: false },
			],
			limit: limit * 2,
		})
	);

	// Merge and deduplicate
	const seenIds = new Set<string>();
	const results: SearchResult[] = [];

	// Title matches get higher score
	for (const entry of titleResults) {
		const typed = entry as unknown as KnowledgeEntry;
		if (typed.id && !seenIds.has(typed.id)) {
			seenIds.add(typed.id);
			results.push(toSearchResult(entry, 1.0, 'keyword'));
		}
	}

	// Content matches get lower score
	for (const entry of contentResults) {
		const typed = entry as unknown as KnowledgeEntry;
		if (typed.id && !seenIds.has(typed.id)) {
			seenIds.add(typed.id);
			results.push(toSearchResult(entry, 0.7, 'keyword'));
		}
	}

	// Filter by tags if needed (post-filter since conditions are ANDed)
	if (tags && tags.length > 0) {
		return results.filter((r) => {
			const entryTags = r.tags || [];
			return tags.some((tag) => entryTags.includes(tag));
		});
	}

	return results;
}

/**
 * Perform semantic (vector) search using HNSW index.
 */
async function semanticSearch(kbId: string, query: string, limit: number = DEFAULT_LIMIT): Promise<SearchResult[]> {
	let queryVector: number[];
	try {
		queryVector = await generateEmbedding(query);
	} catch (error) {
		logger?.warn?.('Semantic search failed — embedding model not available:', (error as Error).message);
		return [];
	}

	const rawResults = await collectResults(
		databases.kb.KnowledgeEntry.search({
			conditions: [{ attribute: 'kbId', comparator: 'equals', value: kbId }],
			sort: { attribute: 'embedding', target: queryVector },
			limit: limit * 2, // Fetch extra to allow for deprecated filtering
		})
	);

	const results: SearchResult[] = [];
	for (const entry of rawResults) {
		const typed = entry as unknown as KnowledgeEntry;
		if (typed.deprecated) continue; // Skip deprecated entries

		// Calculate cosine similarity score (HNSW returns nearest first)
		// Score decreases with position (1.0 for first result, decreasing)
		const positionScore = 1.0 - results.length / (limit * 2);
		results.push(toSearchResult(entry, Math.max(0.1, positionScore), 'semantic'));

		if (results.length >= limit) break;
	}

	return results;
}

/**
 * Perform hybrid search: run both keyword and semantic, merge and deduplicate.
 */
async function hybridSearch(
	kbId: string,
	query: string,
	tags?: string[],
	limit: number = DEFAULT_LIMIT
): Promise<SearchResult[]> {
	// Run both searches in parallel
	const [keywordResults, semanticResults] = await Promise.all([
		keywordSearch(kbId, query, tags, limit),
		semanticSearch(kbId, query, limit),
	]);

	// Merge and deduplicate
	const resultMap = new Map<string, SearchResult>();

	// Add keyword results
	for (const result of keywordResults) {
		resultMap.set(result.id, result);
	}

	// Merge semantic results (combine scores if entry appears in both)
	for (const result of semanticResults) {
		const existing = resultMap.get(result.id);
		if (existing) {
			// Entry found in both — combine scores and mark as hybrid
			existing.score = ((existing.score + result.score) / 2) * 1.3; // Boost for appearing in both
			existing.matchType = 'hybrid';
		} else {
			resultMap.set(result.id, result);
		}
	}

	const merged = Array.from(resultMap.values());
	merged.sort((a, b) => b.score - a.score);

	return merged.slice(0, limit);
}

/**
 * Filter and re-score results based on applicability context.
 *
 * If the caller provides their environment context, results that match get a
 * score boost, while results that specify a different scope get a score penalty
 * (but are NOT hidden). Context dimensions are generic key-value pairs — each
 * KB defines its own (e.g., product version, tier, region, platform).
 */
export function filterByApplicability(results: SearchResult[], context: ApplicabilityContext): SearchResult[] {
	return results.map((result) => {
		const appliesTo = result.appliesTo;
		if (!appliesTo) {
			return result;
		}

		let matchCount = 0;
		let mismatchCount = 0;
		let totalFields = 0;

		for (const key of Object.keys(appliesTo)) {
			if (context[key] === undefined) continue;
			totalFields++;
			const matches = isVersionRange(appliesTo[key])
				? versionMatches(context[key], appliesTo[key])
				: context[key] === appliesTo[key];
			if (matches) {
				matchCount++;
			} else {
				mismatchCount++;
			}
		}

		if (totalFields === 0) {
			return result;
		}

		let adjustedScore = result.score;
		if (matchCount > 0) {
			adjustedScore *= APPLICABILITY_BOOST;
		}
		if (mismatchCount > 0) {
			adjustedScore *= APPLICABILITY_PENALTY;
		}

		return { ...result, score: adjustedScore };
	});
}

/**
 * Detect whether a value looks like a semver range (starts with a range prefix).
 */
function isVersionRange(value: string): boolean {
	return /^[>=<~^]/.test(value);
}

/**
 * Simple version matching.
 * Supports exact match and basic semver range prefixes (>=, <=, ~, ^).
 * For production use, consider a proper semver library.
 */
function versionMatches(actual: string, required: string): boolean {
	// Strip common prefixes for comparison
	const cleanActual = actual.replace(/^[v=]/, '');
	const cleanRequired = required.replace(/^[v=]/, '');

	// Exact match
	if (cleanActual === cleanRequired) return true;

	// Range prefix checks (simplified)
	if (required.startsWith('>=')) {
		return cleanActual >= required.slice(2);
	}
	if (required.startsWith('<=')) {
		return cleanActual <= required.slice(2);
	}

	// For ~ and ^ ranges, just check major.minor match
	if (required.startsWith('~') || required.startsWith('^')) {
		const reqParts = required.slice(1).split('.');
		const actParts = cleanActual.split('.');
		return reqParts[0] === actParts[0] && (reqParts.length < 2 || reqParts[1] === actParts[1]);
	}

	return false;
}

/**
 * Log a search query to the QueryLog table for analytics.
 */
async function logQuery(
	kbId: string,
	query: string,
	context: ApplicabilityContext | undefined,
	results: SearchResult[]
): Promise<void> {
	try {
		await databases.kb.QueryLog.put({
			id: crypto.randomUUID(),
			kbId,
			query,
			context: context || null,
			resultCount: results.length,
			topResultId: results.length > 0 ? results[0].id : null,
		});
	} catch (error) {
		// Don't fail the search if logging fails
		logger?.warn?.('Failed to log search query:', (error as Error).message);
	}
}

/**
 * List entries without search scoring.
 *
 * Returns entries sorted by updatedAt (newest first), with no relevance
 * scoring. Used for browse mode where there's no search query.
 */
export async function listEntries(
	kbId: string,
	tags?: string[],
	limit: number = 30
): Promise<Omit<KnowledgeEntry, 'embedding'>[]> {
	const { stripEmbedding } = await import('./entries.ts');

	const conditions: Array<{
		attribute: string;
		comparator: string;
		value: unknown;
	}> = [
		{ attribute: 'kbId', comparator: 'equals', value: kbId },
		{ attribute: 'deprecated', comparator: 'equals', value: false },
	];

	if (tags && tags.length > 0) {
		for (const tag of tags) {
			conditions.push({ attribute: 'tags', comparator: 'contains', value: tag });
		}
	}

	const records = await collectResults(
		databases.kb.KnowledgeEntry.search({
			conditions,
			sort: { attribute: 'updatedAt', descending: true },
			limit,
		})
	);

	return records.map((record) => stripEmbedding(record));
}

/**
 * Collect all results from an async iterable into an array.
 */
async function collectResults(iterable: AsyncIterable<Record<string, unknown>>): Promise<Record<string, unknown>[]> {
	const results: Record<string, unknown>[] = [];
	for await (const item of iterable) {
		results.push(item);
	}
	return results;
}
