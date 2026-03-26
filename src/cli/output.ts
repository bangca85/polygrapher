export function printError(message: string): void {
  process.stderr.write(`Error: ${message}\n`);
}

export function printSuccess(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function printWarning(message: string): void {
  process.stderr.write(`Warning: ${message}\n`);
}

export function printInfo(message: string): void {
  process.stdout.write(`${message}\n`);
}
