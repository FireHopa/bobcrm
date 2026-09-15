export const LEAD_TEMPERATURES = Object.freeze(["", "Frio", "Morno", "Quente"]);

export function normalizeLeadTemperature(value) {
  const normalized = String(value ?? "").trim();
  if (!LEAD_TEMPERATURES.includes(normalized)) {
    const error = new Error("Temperatura inválida. Use Frio, Morno, Quente ou deixe em branco.");
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}
