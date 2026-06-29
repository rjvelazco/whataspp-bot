import type { CatalogItem, Variant } from "../domain/types.js";
import { normalize } from "./intents.js";

const SIZE_TOKENS = ["xs", "s", "m", "l", "xl", "xxl"];

/** Detect a standalone size token in a message (e.g. "en M" → "M"). */
export function detectSize(text: string): string | undefined {
  const words = normalize(text).split(/[^a-z]+/).filter(Boolean);
  const found = words.find((w) => SIZE_TOKENS.includes(w));
  return found?.toUpperCase();
}

/** Detect a color mentioned in the message that this item actually comes in. */
export function detectColor(item: CatalogItem, text: string): string | undefined {
  const norm = normalize(text);
  const colors = [...new Set(item.variants.map((v) => v.color))];
  return colors.find((c) => norm.includes(normalize(c)));
}

/** Find the catalog item a free-text message refers to (by name or code). */
export function matchItem(catalog: CatalogItem[], text: string): CatalogItem | undefined {
  const norm = normalize(text);
  return (
    catalog.find((it) => norm.includes(normalize(it.name))) ??
    catalog.find((it) => norm.includes(it.code.toLowerCase()))
  );
}

const inStock = (v: Variant): boolean => v.stock > 0;

/** Unique in-stock sizes / colors, for summaries. */
export function availableSizes(item: CatalogItem): string[] {
  return [...new Set(item.variants.filter(inStock).map((v) => v.size))];
}
export function availableColors(item: CatalogItem, size?: string): string[] {
  return [
    ...new Set(
      item.variants
        .filter(inStock)
        .filter((v) => !size || v.size === size)
        .map((v) => v.color),
    ),
  ];
}

/** Catalog card caption (spec §2.2). */
export function itemCard(item: CatalogItem): string {
  const sizes = availableSizes(item);
  const colors = availableColors(item);
  const stockLine = sizes.length
    ? `Tallas: ${sizes.join(", ")} · Colores: ${colors.join(", ")}`
    : "⚠️ Temporalmente agotado";
  return (
    `*${item.name}* — $${item.price.toFixed(2)}\n` +
    `${stockLine}\n` +
    `Escribe *PEDIR ${item.code}* para ordenar.`
  );
}

/** Availability answer for an item, optionally narrowed to a size (spec §2.3). */
export function availabilityMessage(item: CatalogItem, size?: string): string {
  if (size) {
    const colors = availableColors(item, size);
    if (colors.length) {
      return (
        `✅ Sí, el *${item.name}* está disponible en talla ${size} (${colors.join(" y ")}).\n` +
        `¿Quieres ordenarlo? Escribe *PEDIR ${item.code}* o *medidas* para la guía de tallas.`
      );
    }
    const others = availableSizes(item);
    const alt = others.length ? `Disponibles: ${others.join(", ")}.` : "Está agotado por ahora.";
    return `😕 Ahora mismo no tenemos talla ${size} del *${item.name}*. ${alt}`;
  }
  const sizes = availableSizes(item);
  if (!sizes.length) return `😕 El *${item.name}* está agotado por ahora.`;
  return (
    `El *${item.name}* está disponible en: ${sizes.join(", ")} (colores: ${availableColors(item).join(", ")}).\n` +
    `Dime la talla, o escribe *PEDIR ${item.code}* para ordenar.`
  );
}
