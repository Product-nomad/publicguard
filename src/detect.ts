import type { SecretHit } from "./patterns.js";
import { scanForSecrets } from "./patterns.js";

const FP_PATH_FRAGMENTS = [
  "test/",
  "tests/",
  "spec/",
  "__tests__/",
  "example",
  "examples/",
  "sample",
  "samples/",
  "fixture",
  "fixtures/",
  "mock",
  "mocks/",
  "stub/",
  "stubs/",
  "demo/",
  "tutorial/",
  "placeholder",
  "template",
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.test",
  ".env.local.example",
  ".env.fake",
  ".fake",
  "README",
  "readme",
  "CHANGELOG",
  "docs/",
  "doc/",
];

export function isFalsePositivePath(filePath: string): boolean {
  return FP_PATH_FRAGMENTS.some((fragment) =>
    filePath.toLowerCase().includes(fragment.toLowerCase()),
  );
}

export interface ContentHit extends SecretHit {
  lineNumber: number | null;
}

export function detectSecrets(content: string, filePath: string): ContentHit[] {
  if (isFalsePositivePath(filePath)) return [];
  return scanForSecrets(content).map((hit) => ({
    ...hit,
    lineNumber: getLineNumber(content, hit.index),
  }));
}

function getLineNumber(text: string, charIndex: number): number | null {
  if (charIndex < 0 || charIndex >= text.length) return null;
  let line = 1;
  for (let i = 0; i < charIndex; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}
