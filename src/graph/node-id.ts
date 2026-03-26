import crypto from 'node:crypto';

export function generateNodeId(file: string, name: string, line: number): string {
  const input = `${file}:${name}:${line}`;
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 12);
}
