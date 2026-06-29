import pino from "pino";
import { config } from "./config.js";

/** Shared application logger. Baileys also accepts this (it expects a pino logger). */
export const logger = pino({
  level: config.logLevel,
  transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } },
});
