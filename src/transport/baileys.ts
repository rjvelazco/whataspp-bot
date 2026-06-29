import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  useMultiFileAuthState,
  type WASocket,
  type proto,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import { logger } from "../logger.js";
import type { IncomingMessage, MessageHandler, MessagingTransport } from "./types.js";

/** Baileys implementation of the transport seam. Pairs to a real number via QR. */
export class BaileysTransport implements MessagingTransport {
  private sock?: WASocket;
  private handler?: MessageHandler;
  private accountId = "";

  constructor(private readonly authDir: string) {}

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  getAccountId(): string {
    return this.accountId;
  }

  async start(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();

    await new Promise<void>((resolveOpen, rejectOpen) => {
      const connect = () => {
        const sock = makeWASocket({
          version,
          auth: state,
          logger,
          browser: Browsers.appropriate("StoreBot"),
        });
        this.sock = sock;

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", (update) => {
          const { connection, lastDisconnect, qr } = update;
          if (qr) {
            logger.info("Scan this QR with WhatsApp (Linked Devices) to pair the bot:");
            qrcode.generate(qr, { small: true });
          }
          if (connection === "open") {
            this.accountId = jidNormalizedUser(sock.user?.id ?? "");
            logger.info({ accountId: this.accountId }, "WhatsApp connected");
            resolveOpen();
          }
          if (connection === "close") {
            const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
              ?.output?.statusCode;
            const loggedOut = code === DisconnectReason.loggedOut;
            logger.warn({ code, loggedOut }, "WhatsApp connection closed");
            if (loggedOut) {
              rejectOpen(new Error("Logged out — delete the auth/ folder and re-pair."));
            } else {
              connect(); // transient drop — reconnect with persisted creds
            }
          }
        });

        sock.ev.on("messages.upsert", async ({ messages, type }) => {
          if (type !== "notify" || !this.handler) return;
          for (const msg of messages) {
            const incoming = this.toIncoming(msg);
            if (incoming) {
              try {
                await this.handler(incoming);
              } catch (err) {
                logger.error({ err }, "message handler threw");
              }
            }
          }
        });
      };

      connect();
    });
  }

  /** Normalize a raw Baileys message into our transport-agnostic shape. */
  private toIncoming(msg: proto.IWebMessageInfo): IncomingMessage | undefined {
    const jid = msg.key.remoteJid ?? "";
    if (msg.key.fromMe) return undefined;
    if (jid === "status@broadcast" || jid.endsWith("@g.us")) return undefined; // skip status & groups
    const m = msg.message;
    if (!m) return undefined;

    const text =
      m.conversation ??
      m.extendedTextMessage?.text ??
      m.imageMessage?.caption ??
      m.buttonsResponseMessage?.selectedDisplayText ??
      m.listResponseMessage?.title ??
      m.templateButtonReplyMessage?.selectedDisplayText ??
      undefined;

    const imageMessage = m.imageMessage;
    const image = imageMessage
      ? {
          mimetype: imageMessage.mimetype ?? "image/jpeg",
          download: async (): Promise<Buffer> =>
            (await downloadMediaMessage(msg, "buffer", {}, {
              logger,
              reuploadRequest: this.sock!.updateMediaMessage,
            })) as Buffer,
        }
      : undefined;

    if (!text && !image) return undefined;

    return {
      from: jid,
      accountId: this.accountId,
      text: text ?? undefined,
      image,
      timestamp: Number(msg.messageTimestamp ?? 0),
    };
  }

  async sendText(to: string, body: string): Promise<void> {
    await this.sock?.sendMessage(to, { text: body });
  }

  async sendImage(to: string, url: string, caption?: string): Promise<void> {
    await this.sock?.sendMessage(to, { image: { url }, caption });
  }
}
