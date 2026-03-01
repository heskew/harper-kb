/**
 * GitHub Webhook Handler
 *
 * Validates GitHub webhook signatures (HMAC-SHA256) and parses payloads
 * for issues, issue comments, discussions, and discussion comments.
 */

import crypto from 'node:crypto';
import type { WebhookResult } from './types.ts';

/** Maximum body length included in the summary */
const MAX_BODY_LENGTH = 500;

/**
 * Validate a GitHub webhook signature using HMAC-SHA256.
 *
 * @param rawBody - The raw request body string
 * @param signature - The X-Hub-Signature-256 header value
 * @param secret - The configured webhook secret
 * @returns true if the signature is valid
 */
export function validateSignature(rawBody: string, signature: string, secret: string): boolean {
	if (!signature || !secret) return false;

	const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

	// Constant-time comparison to prevent timing attacks
	if (expected.length !== signature.length) return false;
	return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * Parse a GitHub webhook payload and extract a triage-ready result.
 *
 * @param event - The X-GitHub-Event header value
 * @param payload - The parsed JSON payload
 * @returns A WebhookResult for triage, or null if the event should be ignored
 */
export function parsePayload(event: string, payload: Record<string, any>): WebhookResult | null {
	switch (event) {
		case 'issues':
			return parseIssueEvent(payload);
		case 'issue_comment':
			return parseIssueCommentEvent(payload);
		case 'discussion':
			return parseDiscussionEvent(payload);
		case 'discussion_comment':
			return parseDiscussionCommentEvent(payload);
		default:
			return null;
	}
}

function parseIssueEvent(payload: Record<string, any>): WebhookResult | null {
	const action = payload.action;
	const issue = payload.issue;
	const repo = payload.repository?.full_name;

	if (!issue || !repo) return null;

	// Only handle opened, closed, reopened
	const directActions = ['opened', 'closed', 'reopened'];
	if (directActions.includes(action)) {
		return {
			source: 'github-webhook',
			sourceId: `github:issues:${action}:${repo}#${issue.number}`,
			summary: formatIssueSummary(repo, issue, action),
			rawPayload: payload,
		};
	}

	// Handle labeled — only if the label is "kb-candidate"
	if (action === 'labeled') {
		const label = payload.label;
		if (label?.name === 'kb-candidate') {
			return {
				source: 'github-webhook',
				sourceId: `github:issues:labeled:${repo}#${issue.number}`,
				summary: formatIssueSummary(repo, issue, 'labeled'),
				rawPayload: payload,
			};
		}
		return null;
	}

	return null;
}

function parseIssueCommentEvent(payload: Record<string, any>): WebhookResult | null {
	const action = payload.action;
	if (action !== 'created') return null;

	const comment = payload.comment;
	const issue = payload.issue;
	const repo = payload.repository?.full_name;

	if (!comment || !issue || !repo) return null;

	const body = truncate(comment.body || '');
	const summary = [
		`[GitHub Comment] ${repo}#${issue.number}: "${issue.title}" (comment by ${comment.user?.login || 'unknown'})`,
		'---',
		body,
	].join('\n');

	return {
		source: 'github-webhook',
		sourceId: `github:issue_comment:${comment.id}`,
		summary,
		rawPayload: payload,
	};
}

function parseDiscussionEvent(payload: Record<string, any>): WebhookResult | null {
	const action = payload.action;
	if (action !== 'created' && action !== 'answered') return null;

	const discussion = payload.discussion;
	const repo = payload.repository?.full_name;

	if (!discussion || !repo) return null;

	const body = truncate(discussion.body || '');
	const category = discussion.category?.name;
	const summary = [
		`[GitHub Discussion] ${repo}#${discussion.number}: "${discussion.title}" (${action} by ${discussion.user?.login || 'unknown'})`,
		category ? `Category: ${category}` : '',
		'---',
		body,
	]
		.filter(Boolean)
		.join('\n');

	return {
		source: 'github-webhook',
		sourceId: `github:discussion:${action}:${repo}#${discussion.number}`,
		summary,
		rawPayload: payload,
	};
}

function parseDiscussionCommentEvent(payload: Record<string, any>): WebhookResult | null {
	const action = payload.action;
	if (action !== 'created') return null;

	const comment = payload.comment;
	const discussion = payload.discussion;
	const repo = payload.repository?.full_name;

	if (!comment || !discussion || !repo) return null;

	const body = truncate(comment.body || '');
	const summary = [
		`[GitHub Discussion Comment] ${repo}#${discussion.number}: "${discussion.title}" (comment by ${comment.user?.login || 'unknown'})`,
		'---',
		body,
	].join('\n');

	return {
		source: 'github-webhook',
		sourceId: `github:discussion_comment:${comment.id}`,
		summary,
		rawPayload: payload,
	};
}

function formatIssueSummary(repo: string, issue: Record<string, any>, action: string): string {
	const labels = (issue.labels || []).map((l: Record<string, any>) => l.name).join(', ');
	const body = truncate(issue.body || '');

	const parts = [
		`[GitHub Issue] ${repo}#${issue.number}: "${issue.title}" (${action} by ${issue.user?.login || 'unknown'})`,
	];
	if (labels) parts.push(`Labels: ${labels}`);
	parts.push('---');
	parts.push(body);

	return parts.join('\n');
}

function truncate(text: string): string {
	if (text.length <= MAX_BODY_LENGTH) return text;
	return text.slice(0, MAX_BODY_LENGTH) + '...';
}
