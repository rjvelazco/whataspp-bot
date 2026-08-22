import { config } from "../config.js";
import { logger } from "../logger.js";

/**
 * libsignal logs decryption failures with raw `console.error`/`console.log`
 * that bypass our pino logger entirely. For a WhatsApp client these are
 * expected noise: Status broadcasts and messages the bot isn't the recipient
 * of can never be decrypted, and Baileys handles them by sending retry
 * receipts. This redirects those specific lines to logger.debug while leaving
 * every other console message untouched.
 *
 * Deliberately a downgrade rather than a drop: the same lines are the only
 * symptom of sessions genuinely breaking (customer messages silently not
 * arriving), so they must stay recoverable with LOG_LEVEL=debug.
 *
 * Disabled (no filtering) when WA_LOG_LEVEL is turned up for debugging.
 */
const NOISE = [
  "Session error",
  "Failed to decrypt message with any known session",
  "Decrypted message with closed session",
  "Closing session:",
  "Closing open session in favor of incoming prekey bundle",
];

function isSignalNoise(args: unknown[]): boolean {
  const first = args[0];
  if (typeof first !== "string") return false;
  return NOISE.some((n) => first.startsWith(n));
}

export function silenceSignalNoise(): void {
  if (config.waLogLevel !== "silent") return; // debugging Baileys — keep everything

  // Only error/log: libsignal doesn't use console.warn, and patching it would
  // swallow warnings from other libraries for no benefit.
  for (const method of ["error", "log"] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      if (isSignalNoise(args)) {
        logger.debug({ line: args[0] }, "libsignal noise");
        return;
      }
      original(...args);
    };
  }
}
