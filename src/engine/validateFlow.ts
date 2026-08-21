import type { FlowIssue, FlowMenu } from "../domain/types.js";
import { FLOW_ACTIONS } from "../domain/types.js";
import { normalize, parseIntent } from "./intents.js";
import { findEntryMenu, findMenuByKey } from "./handlers.js";

export type { FlowIssue };

const KNOWN_ACTIONS = new Set<string>(FLOW_ACTIONS);

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
export function validateFlow(input: FlowMenu[]): FlowIssue[] {
  const issues: FlowIssue[] = [];

  // --- shape: menus arrive as stored/posted JSON, so nothing is guaranteed ---
  // Every later section indexes into options, so malformed menus are reported
  // and then dropped rather than crashing the caller with a TypeError.
  const menus: FlowMenu[] = [];
  for (const menu of input) {
    if (!menu || typeof menu !== "object") {
      issues.push({ severity: "error", message: "Hay un menú con formato inválido." });
      continue;
    }
    if (!Array.isArray(menu.options)) {
      issues.push({
        severity: "error",
        menuKey: menu.key,
        message: `El menú "${menu.key || "(sin identificador)"}" no tiene una lista de opciones válida.`,
      });
      continue;
    }
    menus.push(menu);
  }
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
      if (!KNOWN_ACTIONS.has(opt.action)) {
        // The engine can't run it, so saving it would silence the bot on that option.
        issues.push({
          severity: "error",
          menuKey: menu.key,
          message: `La opción "${opt.label || "(sin texto)"}" usa una acción desconocida: "${opt.action}".`,
        });
        continue;
      }
      if (opt.action === "go_menu") {
        if (!opt.target || !opt.target.trim()) {
          // Not wired yet — allowed while authoring (the X/Y status shows it); warn only.
          issues.push({
            severity: "warning",
            menuKey: menu.key,
            message: `La opción "${opt.label || "(sin texto)"}" aún no está conectada.`,
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
            severity: "warning",
            menuKey: menu.key,
            message: `La opción "${opt.label || "(sin texto)"}" no indica la categoría a mostrar.`,
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
