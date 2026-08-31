import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  containedPath,
  isLegacyPath,
  isSupportedReceiptType,
  productPhotoSource,
  receiptFilename,
  toStoredFilename,
} from "../src/domain/uploads.js";

describe("receiptFilename", () => {
  it("picks the extension from the allow-list, not from the mimetype string", () => {
    expect(receiptFilename("1009", "image/jpeg")).toBe("receipt-1009.jpg");
    expect(receiptFilename("1009", "image/png")).toBe("receipt-1009.png");
    expect(receiptFilename("1009", "image/webp")).toBe("receipt-1009.webp");
  });

  it("survives a mimetype with parameters", () => {
    // The old code did mimetype.split("/")[1], which produced "jpeg;charset=utf-8"
    // and therefore a file the browser refused to render under nosniff.
    expect(receiptFilename("1009", "image/jpeg; charset=utf-8")).toBe("receipt-1009.jpg");
    expect(receiptFilename("1009", "IMAGE/JPEG")).toBe("receipt-1009.jpg");
  });

  it("falls back to .jpg for an unrecognised type", () => {
    expect(receiptFilename("1009", "application/octet-stream")).toBe("receipt-1009.jpg");
    expect(receiptFilename("1009", "")).toBe("receipt-1009.jpg");
  });

  it("keeps path separators out of the filename", () => {
    expect(receiptFilename("../../etc/passwd", "image/png")).toBe("receipt-etcpasswd.png");
  });

  it("reports which types it can store", () => {
    expect(isSupportedReceiptType("image/jpeg")).toBe(true);
    expect(isSupportedReceiptType("application/pdf")).toBe(false);
  });
});

describe("toStoredFilename", () => {
  it("reduces the exact paths that broke in production", () => {
    // These are the values that were live in the database when the bug was found.
    expect(
      toStoredFilename("/Users/rjvelazco/Desktop/whatsapp-bot/uploads/receipt-1009.jpeg"),
    ).toBe("receipt-1009.jpeg");
    expect(toStoredFilename("/Users/x/uploads/products/abc-123.jpg")).toBe("abc-123.jpg");
  });

  it("is idempotent, so it can run on every boot", () => {
    const once = toStoredFilename("/a/b/receipt-1.jpg");
    expect(toStoredFilename(once)).toBe(once);
  });

  it("rejects values that cannot be a filename", () => {
    expect(toStoredFilename("")).toBeNull();
    expect(toStoredFilename(null)).toBeNull();
    expect(toStoredFilename(undefined)).toBeNull();
    expect(toStoredFilename("   ")).toBeNull();
    expect(toStoredFilename("..")).toBeNull();
    expect(toStoredFilename("/")).toBeNull();
    expect(toStoredFilename("evil\0.jpg")).toBeNull();
  });
});

describe("isLegacyPath", () => {
  it("recognises a value that still needs migrating", () => {
    expect(isLegacyPath("/abs/uploads/receipt-1.jpg")).toBe(true);
    expect(isLegacyPath("uploads/receipt-1.jpg")).toBe(true);
    expect(isLegacyPath("C:\\uploads\\receipt-1.jpg")).toBe(true);
  });

  it("leaves an already-migrated value alone", () => {
    expect(isLegacyPath("receipt-1.jpg")).toBe(false);
    expect(isLegacyPath("")).toBe(false);
    expect(isLegacyPath(null)).toBe(false);
  });
});

describe("productPhotoSource", () => {
  const productsDir = "/srv/uploads/products";

  it("rejoins a stored filename with the products directory", () => {
    // The bot hands this straight to the transport, which reads it as a path. Before,
    // photo_url was an absolute path and worked by accident; as a bare filename it has
    // to be rejoined or Baileys resolves it against the process CWD and fails.
    expect(productPhotoSource("abc.jpg", productsDir)).toBe(join(productsDir, "abc.jpg"));
  });

  it("passes a seeded remote URL through untouched", () => {
    const url = "https://images.unsplash.com/photo-1?w=800&q=80";
    expect(productPhotoSource(url, productsDir)).toBe(url);
  });

  it("returns null for a value it cannot place, rather than a bad path", () => {
    expect(productPhotoSource("", productsDir)).toBeNull();
  });

  it("contains a hostile value inside the products directory", () => {
    expect(productPhotoSource("../../etc/passwd", productsDir)).toBe(join(productsDir, "passwd"));
  });
});

describe("containedPath", () => {
  const root = "/srv/uploads/receipts";

  it("resolves a stored filename inside its directory", () => {
    expect(containedPath(root, "receipt-1009.jpg")).toBe(join(root, "receipt-1009.jpg"));
  });

  it("refuses to escape the directory, however the row is spelled", () => {
    // Asserted exactly rather than "null or inside the root", which would also pass if
    // the guard rejected everything. Traversal reduces to a basename, so it lands inside
    // the root; the values that cannot be a filename at all come back null.
    expect(containedPath(root, "../../../etc/passwd")).toBe(join(root, "passwd"));
    expect(containedPath(root, "/etc/passwd")).toBe(join(root, "passwd"));
    expect(containedPath(root, "..\\..\\windows\\system32")).toBe(join(root, "system32"));
    expect(containedPath(root, "..")).toBeNull();
    expect(containedPath(root, "/")).toBeNull();
    expect(containedPath(root, "")).toBeNull();
  });

  it("returns null rather than throwing on a missing value", () => {
    expect(containedPath(root, null)).toBeNull();
    expect(containedPath(root, undefined)).toBeNull();
  });
});
