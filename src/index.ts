import { config } from "./config.js";
import { logger } from "./logger.js";
import { BaileysTransport } from "./transport/baileys.js";
import type { MessagingTransport } from "./transport/types.js";

async function main() {
  const transport: MessagingTransport = new BaileysTransport(config.authDir);

  // Phase 1 milestone: echo every inbound message back to the sender.
  transport.onMessage(async (msg) => {
    const what = msg.image ? "[imagen]" : msg.text ?? "[mensaje]";
    logger.info({ from: msg.from, what }, "inbound");
    await transport.sendText(msg.from, `recibí: ${what}`);
  });

  await transport.start();
  logger.info("Bot is running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  logger.error({ err }, "fatal");
  process.exit(1);
});
