import { basename, isAbsolute, resolve, sep } from "node:path";

/**
 * The storage convention for uploaded files, in one place.
 *
 * The rule (CLAUDE.md, backend conventions): the database stores a **bare filename**,
 * never a path. It is rejoined with the directory it belongs to at serve time.
 *
 * This was not always true. `receipt_url` and `photo_url` used to hold absolute paths,
 * built from `config.uploadsDir`, which is `resolve()`d against the process CWD at boot.
 * Moving the project directory therefore broke every stored receipt: the files were
 * fine, but `existsSync` was checking a path that no longer existed, the route 404'd,
 * and the UI rendered a broken image because its own guard only checked that the DB
 * string was non-empty. Absolute paths also leaked the host's directory layout to the
 * browser in the API JSON.
 */

/**
 * Extensions a receipt may be stored under, keyed on the mimetype the transport reports.
 *
 * The extension comes from this table and never from the reported mimetype string
 * itself: it used to be `mimetype.split("/")[1]`, so `image/jpeg;charset=x` produced a
 * nonsense extension. Since files are served with `X-Content-Type-Options: nosniff` and
 * the type is inferred from the extension, that meant a browser refusing to render a
 * receipt whose bytes were a perfectly good JPEG.
 */
const RECEIPT_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

/** Whether a receipt of this type can be stored at all. */
export function isSupportedReceiptType(mimetype: string): boolean {
  return normalizeMimetype(mimetype) in RECEIPT_EXT;
}

/** `image/jpeg; charset=utf-8` -> `image/jpeg`. */
function normalizeMimetype(mimetype: string): string {
  return mimetype.split(";")[0].trim().toLowerCase();
}

/**
 * The filename a receipt is stored under. Deterministic per order, so a corrected
 * comprobante replaces the original rather than accumulating; the extension is chosen
 * from the allow-list above, defaulting to .jpg for anything unrecognised.
 */
export function receiptFilename(orderId: string, mimetype: string): string {
  const ext = RECEIPT_EXT[normalizeMimetype(mimetype)] ?? ".jpg";
  // Order ids are generated internally, but they end up in a filename, so keep the
  // set of characters that can reach the filesystem narrow.
  const safeId = orderId.replace(/[^A-Za-z0-9_-]/g, "");
  return `receipt-${safeId}${ext}`;
}

/**
 * Reduce a stored value to the bare filename this codebase expects.
 *
 * Idempotent, so it is safe to run over rows that are already correct: a bare filename
 * comes back unchanged, and a legacy absolute path is reduced to its last segment.
 * Returns null for anything that cannot be a filename, so callers can skip the row
 * rather than write nonsense back.
 */
export function toStoredFilename(value: string | null | undefined): string | null {
  if (!value) return null;
  // Normalise separators before splitting: POSIX basename does not treat a backslash as
  // one, so a Windows-shaped value would survive untouched and be "migrated" on every
  // boot, forever.
  const trimmed = value.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.includes("\0")) return null;
  const name = basename(trimmed);
  // basename("/") is "" and basename("..") is ".."; neither is a file.
  if (!name || name === "." || name === "..") return null;
  return name;
}

/** Whether a stored value still needs migrating. */
export function isLegacyPath(value: string | null | undefined): boolean {
  if (!value) return false;
  return isAbsolute(value) || value.includes("/") || value.includes("\\");
}

/** Seeded products carry remote URLs, which are passed through rather than resolved. */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

/**
 * What to hand to something that will fetch or read a product photo — the URL itself if
 * it is remote, otherwise the file inside productsDir.
 *
 * Both the admin API and the bot's own image send need this. The bot previously received
 * `photo_url` verbatim and passed it to the transport, which worked only while the value
 * was an absolute path; now that it is a bare filename, it has to be rejoined here.
 */
export function productPhotoSource(photoUrl: string, productsDir: string): string | null {
  if (!photoUrl) return null;
  return isHttpUrl(photoUrl) ? photoUrl : containedPath(productsDir, photoUrl);
}

/**
 * Resolve a stored filename inside the directory that owns it, refusing anything that
 * escapes. Every filesystem use of a database-sourced name goes through here: a bad or
 * hostile row must never let us read or delete an arbitrary file.
 *
 * The basename reduction is what actually contains the value; the startsWith check below
 * is belt-and-braces. Note resolve() is lexical, so a symlink planted *inside* the
 * directory still resolves inside it — that needs write access to the uploads tree, so
 * it is defence in depth rather than a live hole.
 */
export function containedPath(root: string, filename: string | null | undefined): string | null {
  const name = toStoredFilename(filename);
  if (!name) return null;
  const abs = resolve(root, name);
  const base = resolve(root) + sep;
  return abs.startsWith(base) ? abs : null;
}
