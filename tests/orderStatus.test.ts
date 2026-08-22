import { describe, expect, it } from "vitest";
import { canTransition, nextStatuses } from "../src/domain/orderStatus.js";

describe("order status transitions", () => {
  it("allows the normal fulfillment path", () => {
    expect(canTransition("pending_payment", "payment_submitted")).toBe(true);
    expect(canTransition("payment_submitted", "confirmed")).toBe(true);
    expect(canTransition("confirmed", "shipped")).toBe(true);
    expect(canTransition("shipped", "delivered")).toBe(true);
  });

  it("refuses to move a finished order", () => {
    // The bug this closes: POST /api/orders/:id/verify accepted any status, so a
    // delivered order could be "confirmed" again — telling the customer their
    // payment had just been verified.
    expect(canTransition("delivered", "confirmed")).toBe(false);
    expect(canTransition("cancelled", "confirmed")).toBe(false);
    expect(canTransition("delivered", "cancelled")).toBe(false);
    expect(nextStatuses("delivered")).toEqual([]);
    expect(nextStatuses("cancelled")).toEqual([]);
  });

  it("allows cancelling only while the order is still open", () => {
    expect(canTransition("pending_payment", "cancelled")).toBe(true);
    expect(canTransition("payment_submitted", "cancelled")).toBe(true);
    expect(canTransition("confirmed", "cancelled")).toBe(true);
    expect(canTransition("shipped", "cancelled")).toBe(false); // already on its way
  });

  it("refuses to skip shipping", () => {
    expect(canTransition("confirmed", "delivered")).toBe(false);
    expect(canTransition("pending_payment", "shipped")).toBe(false);
  });
});
