/**
 * HTTP Utilities for Harper's stream-based request/response handling.
 *
 * Shared by MCP middleware, OAuth middleware, and webhook middleware.
 */

import type { HarperRequest } from './types.ts';

/** Maximum request body size: 1 MB */
const MAX_BODY_SIZE = 1_048_576;

/**
 * Read the request body as a string from Harper's stream-based body.
 *
 * Harper's request.body is a RequestBody wrapper with .on()/.pipe() methods,
 * not a parsed object. We need to consume the stream to get the raw text.
 *
 * Enforces a maximum body size to prevent memory exhaustion from oversized requests.
 */
export function readBody(request: HarperRequest): Promise<string> {
	return new Promise((resolve, reject) => {
		const body = request.body as any;
		if (!body) {
			resolve('');
			return;
		}

		// If body is already a string (unlikely but handle it)
		if (typeof body === 'string') {
			resolve(body);
			return;
		}

		// If body is a stream with .on(), read it
		if (typeof body.on === 'function') {
			const chunks: Buffer[] = [];
			let totalSize = 0;
			body.on('data', (chunk: Buffer) => {
				totalSize += chunk.length;
				if (totalSize > MAX_BODY_SIZE) {
					body.destroy?.();
					reject(new Error('Request body too large'));
					return;
				}
				chunks.push(Buffer.from(chunk));
			});
			body.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
			body.on('error', reject);
			return;
		}

		// If body is already an object (parsed), stringify it
		if (typeof body === 'object') {
			resolve(JSON.stringify(body));
			return;
		}

		resolve(String(body));
	});
}

/**
 * Build Web Standard Headers from Harper's Headers object.
 *
 * Harper's request.headers is a custom Headers class (iterable, with .get()),
 * not a plain Record<string, string>.
 */
export function buildHeaders(request: HarperRequest): Headers {
	const headers = new Headers();
	const src = request.headers;
	if (!src) return headers;

	// Harper's Headers class is iterable with [key, value] pairs
	if (typeof (src as any)[Symbol.iterator] === 'function') {
		for (const [key, value] of src as any) {
			if (value !== undefined) {
				headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
			}
		}
	} else if (typeof src === 'object') {
		// Fallback: plain object
		for (const [key, value] of Object.entries(src)) {
			if (value !== undefined) {
				headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
			}
		}
	}

	return headers;
}

/**
 * Build the base URL (origin) from a Harper request.
 *
 * Uses the request's protocol and host properties. Defaults to
 * http://localhost:9926 if not available.
 */
export function getBaseUrl(request: HarperRequest): string {
	const protocol = (request as any).protocol || 'http';
	const host = (request as any).host || 'localhost:9926';
	return `${protocol}://${host}`;
}

/**
 * Parse an application/x-www-form-urlencoded body into a key-value map.
 */
export function parseFormBody(body: string): Record<string, string> {
	const params = new URLSearchParams(body);
	const result: Record<string, string> = {};
	for (const [key, value] of params) {
		result[key] = value;
	}
	return result;
}

/**
 * Get a header value from Harper's request, case-insensitive.
 */
export function getHeader(request: HarperRequest, name: string): string {
	const headers = request.headers;
	if (!headers) return '';

	// Try .get() method (Harper's Headers class)
	if (typeof (headers as any).get === 'function') {
		const val = (headers as any).get(name);
		if (val !== undefined && val !== null) return String(val);
	}

	// Try direct access (case-sensitive)
	const direct = (headers as any)[name] ?? (headers as any)[name.toLowerCase()];
	if (direct !== undefined) {
		return Array.isArray(direct) ? direct[0] : String(direct);
	}

	// Fallback: iterate to find case-insensitive match
	const lowerName = name.toLowerCase();
	if (typeof (headers as any)[Symbol.iterator] === 'function') {
		for (const [key, value] of headers as any) {
			if (key.toLowerCase() === lowerName && value !== undefined) {
				return Array.isArray(value) ? value[0] : String(value);
			}
		}
	}

	return '';
}
