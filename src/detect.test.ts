import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectSecrets, isFalsePositivePath } from "./detect.js";

describe("isFalsePositivePath", () => {
  it("suppresses test/ paths", () => {
    assert.ok(isFalsePositivePath("test/.env"));
    assert.ok(isFalsePositivePath("src/tests/.env"));
    assert.ok(isFalsePositivePath("__tests__/secrets.ts"));
  });

  it("suppresses example files", () => {
    assert.ok(isFalsePositivePath(".env.example"));
    assert.ok(isFalsePositivePath(".env.sample"));
    assert.ok(isFalsePositivePath("examples/config.env"));
  });

  it("suppresses fixture and mock paths", () => {
    assert.ok(isFalsePositivePath("fixtures/.env"));
    assert.ok(isFalsePositivePath("mocks/auth.ts"));
  });

  it("passes real .env files", () => {
    assert.ok(!isFalsePositivePath(".env"));
    assert.ok(!isFalsePositivePath("src/.env"));
    assert.ok(!isFalsePositivePath("backend/config.env"));
  });
});

describe("detectSecrets", () => {
  it("finds AWS key in content", () => {
    const content = "AWS_ACCESS_KEY_ID=AKIAJ3LXMXPGC5XSH2TQ\n";
    const hits = detectSecrets(content, ".env");
    assert.ok(hits.length > 0, "should find AWS key");
    assert.ok(hits.some((h) => h.patternId === "aws-access-key"));
  });

  it("finds Stripe live key", () => {
    const content = "STRIPE_SECRET=sk_live_abcdefghij1234567890abc\n";
    const hits = detectSecrets(content, ".env");
    assert.ok(hits.some((h) => h.patternId === "stripe-live-secret"));
  });

  it("finds GitHub PAT", () => {
    const content = "GH_TOKEN=ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZabcdef0123\n";
    const hits = detectSecrets(content, ".env");
    assert.ok(hits.some((h) => h.patternId === "github-token"));
  });

  it("returns empty for .env.example path", () => {
    const content = "STRIPE_SECRET=sk_live_abcdefghij1234567890abc\n";
    const hits = detectSecrets(content, ".env.example");
    assert.equal(hits.length, 0);
  });

  it("returns empty for test/ path", () => {
    const content = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n";
    const hits = detectSecrets(content, "test/fixtures/.env");
    assert.equal(hits.length, 0);
  });

  it("includes correct line number", () => {
    const content = "FOO=bar\nAWS_ACCESS_KEY_ID=AKIAJ3LXMXPGC5XSH2TQ\nBAZ=qux\n";
    const hits = detectSecrets(content, ".env");
    const awsHit = hits.find((h) => h.patternId === "aws-access-key");
    assert.ok(awsHit, "should find AWS key");
    assert.equal(awsHit.lineNumber, 2);
  });

  it("suppresses the AWS documentation example key", () => {
    const content = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n";
    const hits = detectSecrets(content, ".env");
    assert.equal(hits.length, 0, "doc example key must be filtered as placeholder");
  });

  it("does not store or expose the raw secret value", () => {
    const key = "AKIAJ3LXMXPGC5XSH2TQ";
    const content = `AWS_ACCESS_KEY_ID=${key}\n`;
    const hits = detectSecrets(content, ".env");
    assert.ok(hits.length > 0);
    for (const hit of hits) {
      assert.ok(!hit.preview.includes(key), "raw key must not appear in preview");
    }
  });
});
