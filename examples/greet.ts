import { camelCase } from "npm:lodash-es@4";

export function greet(name: string): string {
  return `hello ${camelCase(name)}`;
}
