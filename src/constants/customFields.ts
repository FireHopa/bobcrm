import type { LeadCustomFieldKey, LeadCustomFields } from "../types/Lead";

export const spreadsheetCustomFieldLabels: LeadCustomFieldKey[] = [
  "Datas Imersão",
  "Possui website?",
  "Indicado por",
];

const customFieldAliases: Partial<Record<LeadCustomFieldKey, string[]>> = {
  "Possui website?": ["Já possui Website?"],
};

export function createEmptyCustomFields(): LeadCustomFields {
  return spreadsheetCustomFieldLabels.reduce<LeadCustomFields>((fields, label) => {
    fields[label] = "";
    return fields;
  }, {});
}

function getFirstFilledCustomFieldValue(
  customFields: Partial<Record<string, unknown>> | null | undefined,
  labels: string[],
): string {
  for (const label of labels) {
    const value = String(customFields?.[label] ?? "").trim();

    if (value) return value;
  }

  return "";
}

export function normalizeCustomFields(customFields?: Partial<Record<string, unknown>> | null): LeadCustomFields {
  const normalizedFields = createEmptyCustomFields();

  spreadsheetCustomFieldLabels.forEach((label) => {
    const aliases = customFieldAliases[label] || [];
    normalizedFields[label] = getFirstFilledCustomFieldValue(customFields, [label, ...aliases]);
  });

  return normalizedFields;
}
