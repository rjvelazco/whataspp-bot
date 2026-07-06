import makeWASocket, {
  Browsers,
  delay,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  useMultiFileAuthState,
  type WASocket,
  type proto,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import { rmSync } from "node:fs";
import { logger } from "../logger.js";
import type {
  ConnectionListener,
  ConnectionUpdate,
  IncomingMessage,
  MessageHandler,
  MessagingTransport,
} from "./types.js";

/** Baileys implementation of the transport seam. Pairs to a real number via QR. */
export class BaileysTransport implements MessagingTransport {
  private sock?: WASocket;
  private handler?: MessageHandler;
  private connectionListeners: ConnectionListener[] = [];
  private accountId = "";
  private version?: Awaited<ReturnType<typeof fetchLatestBaileysVersion>>["version"];
  private authState?: Awaited<ReturnType<typeof useMultiFileAuthState>>["state"];
  private saveCreds?: () => Promise<void>;
  private onFirstOpen?: () => void;
  /** True while we're logging out and re-initializing, so stale close events are ignored. */
  private loggingOut = false;

  /**
   * @param authDir   where session credentials are persisted
   * @param pairPhone if set (digits incl. country code), pair via 8-char code instead of QR
   */
  constructor(
    private readonly authDir: string,
    private readonly pairPhone = "",
  ) {}

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  onConnectionUpdate(listener: ConnectionListener): void {
    this.connectionListeners.push(listener);
  }

  private emitConnection(update: ConnectionUpdate): void {
    for (const l of this.connectionListeners) l(update);
  }

  getAccountId(): string {
    return this.accountId;
  }

  /** Request an 8-char pairing code (the "Link with phone number" path). */
  private async requestPairing(sock: WASocket): Promise<void> {
    try {
      await delay(3000); // let the socket finish negotiating before requesting
      const code = await sock.requestPairingCode(this.pairPhone);
      const pretty = code.match(/.{1,4}/g)?.join("-") ?? code;
      logger.info(
        `\n\n  Pairing code for +${this.pairPhone}: ${pretty}\n` +
          `  On the phone: WhatsApp → Linked Devices → Link a Device →\n` +
          `  "Link with phone number instead" → enter this code.\n`,
      );
    } catch (err) {
      logger.error({ err }, "failed to request pairing code");
    }
  }

  async start(): Promise<void> {
    const { version } = await fetchLatestBaileysVersion();
    this.version = version;
    await this.setupAuth();
    await new Promise<void>((resolveOpen) => {
      this.onFirstOpen = resolveOpen;
      this.connect();
    });
  }

  /** Unlink the device from WhatsApp, wipe the session, and show a fresh QR. */
  async logout(): Promise<void> {
    this.loggingOut = true;
    try {
      await this.sock?.logout();
    } catch (err) {
      logger.warn({ err }, "logout error (continuing)");
    }
    await this.freshConnect(); // clears creds + reconnects → emits a new QR
    this.loggingOut = false;
    logger.info("logged out — showing a new QR to pair");
  }

  private async setupAuth(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    this.authState = state;
    this.saveCreds = saveCreds;
  }

  /** Wipe the saved session and reconnect from scratch (fresh QR). */
  private async freshConnect(): Promise<void> {
    rmSync(this.authDir, { recursive: true, force: true });
    await this.setupAuth();
    this.connect();
  }

  private connect(): void {
    const sock = makeWASocket({
      version: this.version,
      auth: this.authState!,
      logger,
      browser: Browsers.appropriate("StoreBot"),
    });
    this.sock = sock;

    if (this.saveCreds) sock.ev.on("creds.update", this.saveCreds);

    // Pairing-code mode: request a code instead of relying on the QR.
    if (this.pairPhone && !sock.authState.creds.registered) {
      void this.requestPairing(sock);
    }

    sock.ev.on("connection.update", (update) => {
      if (this.sock !== sock) return; // ignore events from a replaced/stale socket
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        this.emitConnection({ state: "qr", qr });
        if (!this.pairPhone) {
          logger.info("Scan this QR with WhatsApp (Linked Devices) to pair the bot:");
          qrcode.generate(qr, { small: true });
        }
      }
      if (connection === "connecting") {
        this.emitConnection({ state: "connecting" });
      }
      if (connection === "open") {
        this.accountId = jidNormalizedUser(sock.user?.id ?? "");
        this.emitConnection({ state: "open", accountId: this.accountId });
        logger.info({ accountId: this.accountId }, "WhatsApp connected");
        this.onFirstOpen?.();
        this.onFirstOpen = undefined;
      }
      if (connection === "close") {
        if (this.loggingOut) return; // manual re-init in logout() handles this
        const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
          ?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        logger.warn({ code, loggedOut }, "WhatsApp connection closed");
        if (loggedOut) {
          logger.warn("session invalidated — clearing and showing a new QR");
          void this.freshConnect();
        } else {
          this.connect(); // transient drop — reconnect with persisted creds
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (this.sock !== sock) return;
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
  }

  /** Normalize a raw Baileys message into our transport-agnostic shape. */
  private toIncoming(msg: proto.IWebMessageInfo): IncomingMessage | undefined {
    const jid = msg.key.remoteJid ?? "";
    if (msg.key.fromMe) return undefined;
    if (jid === "status@broadcast" || jid.endsWith("@g.us")) return undefined; // skip status & groups
    // WhatsApp now addresses contacts by @lid; the real phone jid arrives as senderPn.
    // Prefer it so conversations/orders key on a phone jid that Status broadcasts accept.
    const key = msg.key as typeof msg.key & { senderPn?: string };
    const from = key.senderPn && key.senderPn.endsWith("@s.whatsapp.net") ? key.senderPn : jid;
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
      from,
      // When we resolved a phone jid, `jid` is the same sender's @lid — pass it so the
      // app can merge any earlier @lid-keyed contact into this phone-jid one.
      altJid: from !== jid ? jid : undefined,
      accountId: this.accountId,
      text: text ?? undefined,
      name: msg.pushName ?? undefined,
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

  async sendDocument(to: string, path: string, fileName: string, mimetype: string): Promise<void> {
    await this.sock?.sendMessage(to, { document: { url: path }, fileName, mimetype });
  }

  /** Post an image as a WhatsApp Status, scoped to the given audience (privacy list). */
  async postStatusImage(path: string, audience: string[], caption?: string): Promise<void> {
    await this.sock?.sendMessage(
      "status@broadcast",
      { image: { url: path }, caption },
      { broadcast: true, statusJidList: audience },
    );
  }
}
