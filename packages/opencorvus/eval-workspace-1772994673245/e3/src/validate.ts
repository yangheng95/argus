/**
 * Validates that a value is a non-empty string.
 * 
 * @param value - The value to validate (accepts unknown type for safety)
 * @returns The trimmed string value
 * @throws Error if value is not a string or is empty after trimming
 */
export function validateName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Name is required and must be a non-empty string");
  }
  return value.trim();
}

/**
 * Validates that a value is a valid email address (contains @).
 * 
 * @param value - The value to validate (accepts unknown type for safety)
 * @returns The trimmed string value
 * @throws Error if value is not a string or does not contain @
 */
export function validateEmail(value: unknown): string {
  if (typeof value !== "string" || !value.includes("@")) {
    throw new Error("Email must be a valid email address");
  }
  return value.trim();
}

/**
 * Validates that a value is a number between 0 and 150.
 * 
 * @param value - The value to validate (accepts unknown type for safety)
 * @returns The validated number value
 * @throws Error if value is not a number or is outside the range [0, 150]
 */
export function validateAge(value: unknown): number {
  if (typeof value !== "number" || value < 0 || value > 150) {
    throw new Error("Age must be a number between 0 and 150");
  }
  return value;
}
