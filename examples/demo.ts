import chalk from "npm:chalk@5";
import { join } from "jsr:@std/path@^1";
import { greet } from "./greet.ts";

const where: string = join("a", "b", "c");
console.log(chalk.green(greet("nodeno")), where, process.argv.slice(2));
