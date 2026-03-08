import { validateName, validateEmail, validateAge } from "./validate";

export interface User {
  name: string;
  email: string;
  age: number;
}

/**
 * Validates that input is a non-null object.
 * @param input - The input to validate
 * @returns The input cast as a Record<string, unknown>
 * @throws {Error} If input is not an object
 */
function validateInputObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") {
    throw new Error("Input must be an object");
  }
  return input as Record<string, unknown>;
}

export function createUser(input: unknown): User {
  const obj = validateInputObject(input);
  const name = validateName(obj.name);
  const email = validateEmail(obj.email);
  const age = validateAge(obj.age);
  return { name, email, age };
}

export function updateUser(existing: User, input: unknown): User {
  const obj = validateInputObject(input);
  // Use existing values for fields not provided in input
  const name = obj.name !== undefined ? obj.name : existing.name;
  const email = obj.email !== undefined ? obj.email : existing.email;
  const age = obj.age !== undefined ? obj.age : existing.age;

  const validatedName = validateName(name);
  const validatedEmail = validateEmail(email);
  const validatedAge = validateAge(age);
  return { name: validatedName, email: validatedEmail, age: validatedAge };
}