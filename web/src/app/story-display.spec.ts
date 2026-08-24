import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatTime,
  joinEs,
  scheduleSummary,
  storyStatusLine,
  type ScheduleDraft,
} from './story-display';
import type { Story } from './api-types';

const draft = (over: Partial<ScheduleDraft> = {}): ScheduleDraft => ({
  mode: 'daily',
  weekdays: [],
  post_date: null,
  post_time: '09:00',
  ...over,
});

const story = (over: Partial<Story> = {}): Story => ({
  id: 'st1',
  store_id: 'novamoda',
  caption: 'Vestidos nuevos',
  mode: 'daily',
  weekdays: [],
  post_date: null,
  post_time: '09:00',
  delete_after: false,
  enabled: true,
  last_posted_at: null,
  created_at: '2026-08-01T00:00:00.000Z',
  media: [{ asset_id: 'a1', position: 0 }],
  ...over,
});

describe('formatTime', () => {
  it('reads as a clock, not as a 24h field', () => {
    expect(formatTime('09:00')).toBe('9:00 AM');
    expect(formatTime('13:05')).toBe('1:05 PM');
    expect(formatTime('00:30')).toBe('12:30 AM');
    expect(formatTime('12:00')).toBe('12:00 PM');
    expect(formatTime('23:59')).toBe('11:59 PM');
  });

  it('passes anything unparseable straight through', () => {
    expect(formatTime('')).toBe('');
    expect(formatTime('nueve')).toBe('nueve');
  });
});

describe('formatDate', () => {
  it('reads the date as written, not as UTC', () => {
    // new Date("2026-08-24") is midnight UTC, which is the 23rd in Caracas — the whole
    // reason this parses by hand.
    expect(formatDate('2026-08-24')).toBe('24 de agosto');
    expect(formatDate('2026-01-01')).toBe('1 de enero');
    expect(formatDate('2026-12-31')).toBe('31 de diciembre');
    expect(formatDate(null)).toBe('');
  });
});

describe('joinEs', () => {
  it('joins the Spanish way', () => {
    expect(joinEs([])).toBe('');
    expect(joinEs(['lunes'])).toBe('lunes');
    expect(joinEs(['lunes', 'martes'])).toBe('lunes y martes');
    expect(joinEs(['lunes', 'miércoles', 'viernes'])).toBe('lunes, miércoles y viernes');
  });
});

describe('scheduleSummary', () => {
  it('describes each mode in plain language', () => {
    expect(scheduleSummary(draft())).toBe('Se publica todos los días a las 9:00 AM.');
    expect(scheduleSummary(draft({ mode: 'weekly', weekdays: [1, 3, 5] }))).toBe(
      'Se publica los lunes, miércoles y viernes a las 9:00 AM.',
    );
    expect(scheduleSummary(draft({ mode: 'once', post_date: '2026-08-24' }))).toBe(
      'Se publica una sola vez, el 24 de agosto a las 9:00 AM.',
    );
  });

  it('collapses a full week rather than listing seven days', () => {
    expect(scheduleSummary(draft({ mode: 'weekly', weekdays: [1, 2, 3, 4, 5, 6, 7] }))).toBe(
      'Se publica todos los días a las 9:00 AM.',
    );
  });

  it('says what is still missing instead of describing an impossible schedule', () => {
    expect(scheduleSummary(draft({ mode: 'weekly' }))).toBe('Elige al menos un día de la semana.');
    expect(scheduleSummary(draft({ mode: 'once' }))).toBe('Elige la fecha de publicación.');
  });
});

describe('storyStatusLine', () => {
  it('leads with the reason a story is not going out', () => {
    expect(storyStatusLine(story({ enabled: false }))).toBe(
      'En pausa. No se publica hasta que la actives.',
    );
    expect(
      storyStatusLine(
        story({ mode: 'once', post_date: '2026-08-24', last_posted_at: '2026-08-24T09:00:00Z' }),
      ),
    ).toBe('Ya se publicó.');
  });

  it('otherwise describes the schedule', () => {
    expect(storyStatusLine(story())).toBe('Se publica todos los días a las 9:00 AM.');
    // A repeating story that already ran today still describes what it does.
    expect(storyStatusLine(story({ last_posted_at: '2026-08-24T09:00:00Z' }))).toBe(
      'Se publica todos los días a las 9:00 AM.',
    );
  });
});
