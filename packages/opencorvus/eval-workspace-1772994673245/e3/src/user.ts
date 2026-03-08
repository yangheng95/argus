import { validateName, validateEmail, validateAge } from "./validate";

export interface User {
  name: string;
  email: string;
  age: number;
}

export function createUser(input: unknown): User {
  if (!input || typeof input !== "object") {
    throw new Error("Input must be an object");
  }
  const obj = input as Record<string, unknown>;
  
  // Use shared validation functions
  const name = validateName(obj.name);
  const email = validateEmail(obj.email);
  const age = validateAge(obj.age);
  
  return { name, email, age };
}

export function updateUser(existing: User, input: unknown): User {
  if (!input || typeof input !== "object") {
    throw new Error("Input must be an object");
  }
  const obj = input as Record<string, unknown>;
  
  // Merge existing values with input values
  const name = obj.name !== undefined ? obj.name : existing.name;
  const email = obj.email !== undefined ? obj.email : existing.email;
  const age = obj.age !== undefined ? obj.age : existing.age;

  // Use shared validation functions
  const validatedName = validateName(name);
  const validatedEmail = validateEmail(email);
  const validatedAge = validateAge(age);
  
  return { name: validatedName, email: validatedEmail, age: validatedAge };
}