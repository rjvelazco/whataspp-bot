import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  containedPath,
  isLegacyPath,
  isSupportedReceiptType,
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

  it("is deterministic, so a corrected receipt replaces rather than accumulates", () => {
    expect(receiptFilename("1009", "image/jpeg")).toBe(receiptFilename("1009", "image/jpeg"));
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

describe("containedPath", () => {
  const root = "/srv/uploads/receipts";

  it("resolves a stored filename inside its directory", () => {
    expect(containedPath(root, "receipt-1009.jpg")).toBe(join(root, "receipt-1009.jpg"));
  });

  it("refuses to escape the directory, however the row is spelled", () => {
    // A hostile or corrupt row must never reach an arbitrary file. Note these reduce to
    // a basename first, so they land inside the root rather than outside it — the point
    // is that the result is never /etc/passwd.
    for (const hostile of ["../../../etc/passwd", "/etc/passwd", "..", "/", ""]) {
      const out = containedPath(root, hostile);
      expect(out === null || out.startsWith(root)).toBe(true);
      expect(out).not.toBe("/etc/passwd");
    }
  });

  it("returns null rather than throwing on a missing value", () => {
    expect(containedPath(root, null)).toBeNull();
    expect(containedPath(root, undefined)).toBeNull();
  });
});
