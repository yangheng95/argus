/**
 * Validation error thrown when validation fails.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Validates that a name is a non-empty string.
 * @param name - The name value to validate
 * @returns The trimmed name if valid
 * @throws {ValidationError} If name is not a non-empty string
 */
export function validateName(name: unknown): string {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new ValidationError("Name is required and must be a non-empty string");
  }
  return name.trim();
}

/**
 * Validates that an email contains an @ symbol.
 * @param email - The email value to validate
 * @returns The trimmed email if valid
 * @throws {ValidationError} If email is not a valid email address
 */
export function validateEmail(email: unknown): string {
  if (typeof email !== "string" || !email.includes("@")) {
    throw new ValidationError("Email must be a valid email address");
  }
  return email.trim();
}

/**
 * Validates that age is a number between 0 and 150.
 * @param age - The age value to validate
 * @returns The age if valid
 * @throws {ValidationError} If age is not a number between 0 and 150
 */
export function validateAge(age: unknown): number {
  if (typeof age !== "number" || age < 0 || age > 150) {
    throw new ValidationError("Age must be a number between 0 and 150");
  }
  return age;
}
