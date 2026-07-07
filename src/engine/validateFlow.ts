import type { FlowIssue, FlowMenu } from "../domain/types.js";
import { normalize, parseIntent } from "./intents.js";
import { findEntryMenu, findMenuByKey } from "./handlers.js";

export type { FlowIssue };

/** Split a comma-separated trigger string into normalized, non-empty keywords. */
function triggerWords(menu: FlowMenu): string[] {
  return (menu.trigger ?? "")
    .split(",")
    .map((t) => normalize(t))
    .filter(Boolean);
}

/**
 * Validate a bot flow (pure). Errors should block a save; warnings are advisory.
 * Covers: duplicate/empty keys, go_menu target problems, show_category missing a
 * category, unreachable menus, and trigger collisions (with a global keyword or
 * another menu).
 */
export function validateFlow(menus: FlowMenu[]): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const keys = menus.map((m) => m.key);

  // --- keys ---
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const k of keys) {
    if (!k || !k.trim()) {
      issues.push({ severity: "error", message: "Hay un menú sin identificador." });
      continue;
    }
    if (seen.has(k)) dupes.add(k);
    seen.add(k);
  }
  for (const k of dupes) {
    issues.push({ severity: "error", menuKey: k, message: `Identificador duplicado: "${k}".` });
  }

  // --- per-option checks ---
  for (const menu of menus) {
    for (const opt of menu.options) {
      if (opt.action === "go_menu") {
        if (!opt.target || !opt.target.trim()) {
          issues.push({
            severity: "error",
            menuKey: menu.key,
            message: `La opción "${opt.label || "(sin texto)"}" va a un menú pero no tiene destino.`,
          });
        } else if (!findMenuByKey(menus, opt.target)) {
          issues.push({
            severity: "error",
            menuKey: menu.key,
            message: `La opción "${opt.label || "(sin texto)"}" apunta a un menú inexistente: "${opt.target}".`,
          });
        }
      } else if (opt.action === "show_category") {
        const category = opt.value ?? opt.target;
        if (!category || !category.trim()) {
          issues.push({
            severity: "error",
            menuKey: menu.key,
            message: `La opción "${opt.label || "(sin texto)"}" muestra una categoría pero no indica cuál.`,
          });
        }
      }
    }
  }

  // --- reachability from the entry menu (BFS over go_menu targets) ---
  const entry = findEntryMenu(menus);
  if (entry) {
    const reachable = new Set<string>();
    const queue = [entry.key];
    while (queue.length) {
      const k = queue.shift()!;
      if (reachable.has(k)) continue;
      reachable.add(k);
      for (const opt of findMenuByKey(menus, k)?.options ?? []) {
        if (opt.action === "go_menu" && opt.target && !reachable.has(opt.target)) {
          queue.push(opt.target);
        }
      }
    }
    for (const menu of menus) {
      if (menu.key && !reachable.has(menu.key)) {
        issues.push({
          severity: "warning",
          menuKey: menu.key,
          message: `El menú "${menu.name || menu.key}" no es alcanzable desde el inicio (ninguna opción lo enlaza).`,
        });
      }
    }
  }

  // --- trigger collisions ---
  const triggerOwners = new Map<string, string[]>();
  for (const menu of menus) {
    for (const word of triggerWords(menu)) {
      // A trigger reserved by a keyword never fires the trigger (the keyword wins).
      // greeting/menu words (hola, menu, inicio) are exempt: they route to the entry
      // menu by design, which is exactly where owners put them.
      const t = parseIntent(word).type;
      if (t !== "text" && t !== "greeting" && t !== "menu") {
        issues.push({
          severity: "warning",
          menuKey: menu.key,
          message: `El disparador "${word}" es una palabra reservada del bot y no abrirá este menú.`,
        });
      }
      triggerOwners.set(word, [...(triggerOwners.get(word) ?? []), menu.key]);
    }
  }
  for (const [word, owners] of triggerOwners) {
    if (owners.length > 1) {
      issues.push({
        severity: "warning",
        message: `El disparador "${word}" está repetido en varios menús (${owners.join(", ")}); solo abrirá el primero.`,
      });
    }
  }

  return issues;
}
