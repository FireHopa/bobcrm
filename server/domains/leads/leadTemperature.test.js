import test from "node:test";
import assert from "node:assert/strict";
import { LEAD_TEMPERATURES, normalizeLeadTemperature } from "./leadTemperature.js";
import { normalizeLead } from "./leadMapper.js";

test("Personalizado é uma temperatura válida e preservada na atualização do lead", () => {
  assert.ok(LEAD_TEMPERATURES.includes("Personalizado"));
  assert.equal(normalizeLeadTemperature("Personalizado"), "Personalizado");
  assert.equal(normalizeLeadTemperature(" Personalizado "), "Personalizado");
  assert.equal(normalizeLead({ id: "lead-personalizado", temperature: "Personalizado" }).temperature, "Personalizado");
});

test("temperaturas anteriores continuam válidas e valores desconhecidos seguem bloqueados", () => {
  for (const temperature of ["", "Frio", "Morno", "Quente"]) {
    assert.equal(normalizeLeadTemperature(temperature), temperature);
  }
  assert.throws(() => normalizeLeadTemperature("Outro"), (error) => {
    assert.equal(error.statusCode, 400);
    return /Temperatura inválida/.test(error.message);
  });
});
