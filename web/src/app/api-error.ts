import type { FlowIssue } from './api-types';

/**
 * Reading a failed API response in one place, so error branches stay one line
 * and no component has to cast `any` to reach into the body.
 */
/**
 * Read the response shape structurally rather than with `instanceof`.
 *
 * An HttpErrorResponse from a different copy of the framework fails an instanceof check,
 * and the class cannot be constructed in a unit test without pulling in Angular's JIT
 * compiler. Both problems go away by reading the two fields we actually use.
 */
function errorBody(e: unknown): Record<string, unknown> | undefined {
  const body = (e as { error?: unknown } | null)?.error;
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : undefined;
}

function statusOf(e: unknown): number | undefined {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
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

/**
 * Why a request failed, in words a shop owner can act on.
 *
 * `apiErrorMessage` returns what the API said, which is right when the API answered.
 * These two cases are the ones where it did not, and where a bare "no se pudo cargar"
 * leaves nothing to do:
 *
 * - **status 0** — nothing answered. The bot process is down or restarting.
 * - **status 404** — something answered, but it does not have this endpoint. That means
 *   the running bot is older than the panel being served: the usual cause is a previous
 *   process that never exited still holding the port.
 */
export function apiFailureReason(e: unknown, fallback = 'Intenta de nuevo.'): string {
  const status = statusOf(e);
  if (status === 0) return 'No hay respuesta del bot. ¿Se está reiniciando?';
  if (status === 404) {
    return 'El bot que está corriendo es más viejo que este panel. Reinícialo.';
  }
  return apiErrorMessage(e, fallback);
}
