import { SHAPE_FIELDS } from "@/lib/ai/prompts";

export type CategoryInput = {
  name?: string;
  description?: string | null;
  shape?: string;
  divisor?: number;
  divisorLabel?: string | null;
  importMode?: string;
  dedupField?: string | null;
  storedFields?: string[];
  valueField?: string;
  active?: boolean;
  sortOrder?: number;
};

export type ValidationError = { field: string; message: string };

export function validateCategoryInput(input: CategoryInput): ValidationError[] {
  const errors: ValidationError[] = [];

  const name = input.name?.trim() ?? "";
  if (!name) errors.push({ field: "name", message: "Name is required." });
  else if (name.length > 60) errors.push({ field: "name", message: "Name must be 60 characters or fewer." });

  if (!input.shape || !SHAPE_FIELDS[input.shape]) {
    errors.push({ field: "shape", message: `Shape must be one of: ${Object.keys(SHAPE_FIELDS).join(", ")}.` });
  }

  // free_text categories (e.g. Squads) don't roll up into a single dashboard value -
  // they write several decimal fields straight onto the member record instead - so
  // divisor/import-mode/value-field/dedup-field simply don't apply to them.
  const isFreeText = input.shape === "free_text";

  if (!isFreeText) {
    if (typeof input.divisor !== "number" || !Number.isFinite(input.divisor) || input.divisor <= 0) {
      errors.push({ field: "divisor", message: "Divisor must be a number greater than 0." });
    }

    if (input.importMode !== "single" && input.importMode !== "multi") {
      errors.push({ field: "importMode", message: "Import mode must be 'single' or 'multi'." });
    }
  }

  const shapeFields = input.shape ? (SHAPE_FIELDS[input.shape] ?? []) : [];
  const shapeFieldKeys = shapeFields.map((f) => f.key);

  if (!Array.isArray(input.storedFields) || input.storedFields.length === 0) {
    errors.push({ field: "storedFields", message: "Select at least one field to store." });
  } else {
    const invalid = input.storedFields.filter((f) => !shapeFieldKeys.includes(f));
    if (invalid.length > 0) {
      errors.push({ field: "storedFields", message: `Unknown field(s) for this shape: ${invalid.join(", ")}.` });
    }
  }

  if (!isFreeText) {
    if (!input.valueField) {
      errors.push({ field: "valueField", message: "Value field is required." });
    } else {
      const numericFields = shapeFields.filter((f) => f.numeric).map((f) => f.key);
      if (!numericFields.includes(input.valueField)) {
        errors.push({ field: "valueField", message: "Value field must be a numeric field for this shape." });
      }
      if (Array.isArray(input.storedFields) && !input.storedFields.includes(input.valueField)) {
        errors.push({ field: "valueField", message: "Value field must be one of the stored fields." });
      }
    }

    if (input.importMode === "multi") {
      if (!input.dedupField) {
        errors.push({
          field: "dedupField",
          message: "Multi-import categories need a dedup field (an in-image date or identifier - not the upload filename).",
        });
      } else if (Array.isArray(input.storedFields) && !input.storedFields.includes(input.dedupField)) {
        errors.push({ field: "dedupField", message: "Dedup field must be one of the stored fields." });
      }
    }
  }

  return errors;
}

export function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "category"
  );
}
