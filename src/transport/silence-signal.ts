import { config } from "../config.js";

/**
 * libsignal logs decryption failures with raw `console.error`/`console.log`
 * that bypass our pino logger entirely. For a WhatsApp client these are
 * expected noise: Status broadcasts and messages the bot isn't the recipient
 * of can never be decrypted, and Baileys handles them by sending retry
 * receipts. This filters out those specific lines while leaving every other
 * console message untouched.
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

  for (const method of ["error", "log", "warn"] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      if (isSignalNoise(args)) return;
      original(...args);
    };
  }
}
