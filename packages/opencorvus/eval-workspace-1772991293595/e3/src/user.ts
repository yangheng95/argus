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
  // 使用共享验证函数复用验证逻辑
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
  // 合并默认值：如果 input 中有对应字段则使用，否则使用 existing 的值
  const name = obj.name !== undefined ? obj.name : existing.name;
  const email = obj.email !== undefined ? obj.email : existing.email;
  const age = obj.age !== undefined ? obj.age : existing.age;

  // 使用共享验证函数复用验证逻辑
  const validatedName = validateName(name);
  const validatedEmail = validateEmail(email);
  const validatedAge = validateAge(age);
  return { name: validatedName, email: validatedEmail, age: validatedAge };
}