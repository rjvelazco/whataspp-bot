/**
 * Transport abstraction — the only seam between the bot engine and WhatsApp.
 *
 * The pilot implements this with Baileys (transport/baileys.ts). A future Meta
 * Cloud API adapter implements the same interface, and no engine code changes.
 */

/** An inbound message normalized away from any provider's payload shape. */
export interface IncomingMessage {
  /** The customer's WhatsApp id (the conversation key). */
  from: string;
  /** Which bot account/number this arrived on → resolveStore(). */
  accountId: string;
  /** Plain text, or the extracted label of a button/list reply. */
  text?: string;
  /** Present when the customer sent an image (e.g. a payment receipt). */
  image?: {
    download: () => Promise<Buffer>;
    mimetype: string;
  };
  /** Unix epoch seconds. */
  timestamp: number;
}

export type MessageHandler = (message: IncomingMessage) => Promise<void>;

/** Connection lifecycle, surfaced so a web UI can show the QR / linked state. */
export interface ConnectionUpdate {
  state: "connecting" | "qr" | "open";
  /** Raw QR string to render (only when state === "qr"). */
  qr?: string;
  /** The linked account id (only when state === "open"). */
  accountId?: string;
}

export type ConnectionListener = (update: ConnectionUpdate) => void;

export interface MessagingTransport {
  /** Register the single handler that receives every inbound message. */
  onMessage(handler: MessageHandler): void;
  /** Subscribe to connection lifecycle updates (QR string, linked state). */
  onConnectionUpdate(listener: ConnectionListener): void;
  /** Send a plain text message. */
  sendText(to: string, body: string): Promise<void>;
  /** Send an image by URL with an optional caption. */
  sendImage(to: string, url: string, caption?: string): Promise<void>;
  /** Connect (Baileys: restore creds / print pairing QR). Resolves once linked. */
  start(): Promise<void>;
  /** The account/number this bot is connected as (known after start()). */
  getAccountId(): string;
}
