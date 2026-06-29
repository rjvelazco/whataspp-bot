import type { Intent } from "./intents.js";
import type { EngineInput, HandlerOutput } from "./stateMachine.js";
import { text } from "./stateMachine.js";
import { categoryMenu, shippingAndPayments } from "./menus.js";

const stay = (input: EngineInput, replies: HandlerOutput["replies"]): HandlerOutput => ({
  replies,
  nextState: input.conversation.state,
});

const dontUnderstand = (input: EngineInput): HandlerOutput =>
  stay(input, [text("No te entendí 🤔. Escribe *menu* para ver las opciones.")]);

/** Route a parsed intent through the per-state logic. */
export function dispatch(intent: Intent, input: EngineInput): HandlerOutput {
  switch (input.conversation.state) {
    case "idle":
      return handleIdle(intent, input);
    case "choosing_category":
      return handleChoosingCategory(intent, input);
    default:
      return dontUnderstand(input);
  }
}

/** Main-menu selection. */
function handleIdle(intent: Intent, input: EngineInput): HandlerOutput {
  if (intent.type !== "choice") return dontUnderstand(input);
  switch (intent.index) {
    case 1: // Ver catálogo
      return { replies: [text(categoryMenu(input.store))], nextState: "choosing_category" };
    case 4: // Envíos y pagos
      return stay(input, [text(shippingAndPayments(input.store))]);
    // Cases 2 (consultar talla), 3 (hacer pedido) and 5 (hablar) are wired in later phases /
    // handled by global intents. Until then, nudge.
    default:
      return stay(input, [text("Esa opción aún no está disponible. Escribe *menu*.")]);
  }
}

/** Pick a category — items listing arrives in Phase 3. */
function handleChoosingCategory(intent: Intent, input: EngineInput): HandlerOutput {
  const categories = input.store.categories;
  if (intent.type !== "choice" || intent.index < 1 || intent.index > categories.length) {
    return stay(input, [text(categoryMenu(input.store))]);
  }
  const category = categories[intent.index - 1];
  return stay(input, [
    text(`📂 ${category}: catálogo en construcción. Escribe *menu* para volver.`),
  ]);
}
