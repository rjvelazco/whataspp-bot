import { HttpErrorResponse } from '@angular/common/http';
import type { FlowIssue } from './api-types';

/**
 * Reading a failed API response in one place, so error branches stay one line
 * and no component has to cast `any` to reach into the body.
 */
function errorBody(e: unknown): Record<string, unknown> | undefined {
  const body = e instanceof HttpErrorResponse ? e.error : undefined;
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : undefined;
}

/** The message the API sent with a failure, or a usable fallback. */
export function apiErrorMessage(e: unknown, fallback = 'Intenta de nuevo.'): string {
  const message = errorBody(e)?.['error'];
  return typeof message === 'string' && message ? message : fallback;
}

/** Flow-validation issues that made the API reject a menu save. */
export function apiIssues(e: unknown): FlowIssue[] {
  const issues = errorBody(e)?.['issues'];
  return Array.isArray(issues) ? (issues as FlowIssue[]) : [];
}
