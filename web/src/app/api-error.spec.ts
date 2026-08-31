import { describe, expect, it } from 'vitest';
import { apiErrorMessage, apiFailureReason, apiIssues } from './api-error';

/**
 * Shaped like an HttpErrorResponse without being one: the real class cannot be built
 * here without Angular's JIT compiler, and the helpers read these two fields anyway.
 */
const httpError = (status: number, body?: unknown) => ({ status, error: body });

describe('apiFailureReason', () => {
  it('names the two failures a shop owner can actually act on', () => {
    // Nothing answered: the bot is down or restarting.
    expect(apiFailureReason(httpError(0))).toBe('No hay respuesta del bot. ¿Se está reiniciando?');
    // Something answered but has no such route — an older bot still holding the port,
    // which is exactly what a process that survived Ctrl+C looks like from here.
    expect(apiFailureReason(httpError(404))).toBe(
      'El bot que está corriendo es más viejo que este panel. Reinícialo.',
    );
  });

  it('otherwise prefers what the API actually said', () => {
    expect(apiFailureReason(httpError(400, { error: 'Esa fecha ya pasó.' }))).toBe(
      'Esa fecha ya pasó.',
    );
  });

  it('falls back when the body carries no message', () => {
    expect(apiFailureReason(httpError(500), 'Intenta más tarde.')).toBe('Intenta más tarde.');
    expect(apiFailureReason(new Error('boom'), 'Intenta más tarde.')).toBe('Intenta más tarde.');
  });
});

describe('apiErrorMessage', () => {
  it('reads the message the API sent', () => {
    expect(apiErrorMessage(httpError(400, { error: 'Elige la fecha.' }))).toBe('Elige la fecha.');
  });

  it('falls back for a body with nothing usable in it', () => {
    expect(apiErrorMessage(httpError(500, 'plain text'), 'Intenta de nuevo.')).toBe(
      'Intenta de nuevo.',
    );
    expect(apiErrorMessage(undefined)).toBe('Intenta de nuevo.');
  });
});

describe('apiIssues', () => {
  it('returns the flow issues, or an empty list', () => {
    const issues = [{ severity: 'error', message: 'x' }];
    expect(apiIssues(httpError(400, { issues }))).toEqual(issues);
    expect(apiIssues(httpError(400, { error: 'x' }))).toEqual([]);
    expect(apiIssues(new Error('boom'))).toEqual([]);
  });
});
