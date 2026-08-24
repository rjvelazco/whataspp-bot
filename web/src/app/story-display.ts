import type { Story, StoryMode } from './api-types';

/**
 * How a schedule is described to a shop owner.
 *
 * The bot never renders these sentences — it only evaluates the schedule — so this is
 * copy, and copy lives in the UI. What is shared with the backend is the `Story` shape
 * itself, through api-types.ts.
 */

/** ISO weekdays, Monday first, the way a Spanish week is written. */
export const WEEKDAYS: { value: number; short: string; label: string }[] = [
  { value: 1, short: 'L', label: 'lunes' },
  { value: 2, short: 'M', label: 'martes' },
  { value: 3, short: 'X', label: 'miércoles' },
  { value: 4, short: 'J', label: 'jueves' },
  { value: 5, short: 'V', label: 'viernes' },
  { value: 6, short: 'S', label: 'sábado' },
  { value: 7, short: 'D', label: 'domingo' },
];

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** "09:00" -> "9:00 AM". */
export function formatTime(time: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time ?? '');
  if (!m) return time ?? '';
  const h24 = Number(m[1]);
  const hour = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${hour}:${m[2]} ${h24 >= 12 ? 'PM' : 'AM'}`;
}

/** "2026-08-24" -> "24 de agosto". Parsed by hand: `new Date("…")` reads it as UTC. */
export function formatDate(date: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!m) return '';
  return `${Number(m[3])} de ${MONTHS[Number(m[2]) - 1] ?? ''}`;
}

/** ["lunes","miércoles","viernes"] -> "lunes, miércoles y viernes". */
export function joinEs(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

function weekdayNames(weekdays: number[]): string {
  const names = WEEKDAYS.filter((d) => weekdays.includes(d.value)).map((d) => d.label);
  if (names.length === 7) return 'todos los días';
  return `los ${joinEs(names)}`;
}

/** The schedule shape the summary needs — so the composer can describe a draft too. */
export interface ScheduleDraft {
  mode: StoryMode;
  weekdays: number[];
  post_date: string | null;
  post_time: string;
}

/** "Se publica todos los días a las 9:00 AM." */
export function scheduleSummary(s: ScheduleDraft): string {
  const time = `a las ${formatTime(s.post_time)}`;
  switch (s.mode) {
    case 'daily':
      return `Se publica todos los días ${time}.`;
    case 'weekly':
      return s.weekdays.length === 0
        ? 'Elige al menos un día de la semana.'
        : `Se publica ${weekdayNames(s.weekdays)} ${time}.`;
    case 'once':
      return s.post_date
        ? `Se publica una sola vez, el ${formatDate(s.post_date)} ${time}.`
        : 'Elige la fecha de publicación.';
  }
}

/** The line under a story card: what it will do next, or what it already did. */
export function storyStatusLine(story: Story): string {
  if (!story.enabled) return 'En pausa. No se publica hasta que la actives.';
  if (story.mode === 'once' && story.last_posted_at) return 'Ya se publicó.';
  return scheduleSummary(story);
}
