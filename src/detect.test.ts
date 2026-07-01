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

  it("suppresses a Firebase web config API key", () => {
    const content = `
      const firebaseConfig = {
        apiKey: "AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBc0",
        authDomain: "my-app.firebaseapp.com",
        projectId: "my-app",
        storageBucket: "my-app.appspot.com",
        messagingSenderId: "123456789",
        appId: "1:123456789:web:abcdef",
      };
    `;
    const hits = detectSecrets(content, "src/firebase.ts");
    assert.equal(hits.length, 0, "Firebase web config key is public by design");
  });

  it("still flags a bare Google API key with no Firebase context", () => {
    const content = 'GOOGLE_MAPS_KEY="AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBc0"\n';
    const hits = detectSecrets(content, ".env");
    assert.ok(hits.some((h) => h.patternId === "google-api-key"));
  });

  it("suppresses low-entropy password assignments (degenerate strings)", () => {
    const content = 'password = "aaaaaaaaaaaaaaaa"\n';
    const hits = detectSecrets(content, "config.py");
    assert.equal(hits.length, 0, "repeated-char string must fail the entropy floor");
  });

  it("still flags a high-entropy password assignment", () => {
    const content = 'password = "xK9$mQ2#vL8pR3nT!wZ7"\n';
    const hits = detectSecrets(content, "config.py");
    assert.ok(hits.some((h) => h.patternId === "generic-password-assign"));
  });

  it("rejects a JWT-shaped match whose payload isn't valid JSON", () => {
    const fake =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
      ".dGhpcyBpcyBub3QganNvbiBhdCBhbGwsIGp1c3QgZmlsbGVyIHRleHQ" +
      ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const hits = detectSecrets(`TOKEN=${fake}\n`, ".env");
    assert.equal(hits.length, 0, "non-JSON payload means it isn't a real JWT");
  });

  it("labels an expired JWT distinctly from a live one", () => {
    const validJwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
      ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjQxMDI0NDQ4MDB9" +
      ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const expiredJwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
      ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjEwMDAwMDAwMDB9" +
      ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

    const validHits = detectSecrets(`TOKEN=${validJwt}\n`, ".env");
    const expiredHits = detectSecrets(`TOKEN=${expiredJwt}\n`, ".env");

    assert.ok(validHits.some((h) => h.patternId === "jwt" && !h.label.includes("expired")));
    assert.ok(expiredHits.some((h) => h.patternId === "jwt" && h.label.includes("expired")));
  });

  it("gives distinct value hashes to distinct secrets, matching hashes to identical ones", () => {
    const content =
      "AWS_ACCESS_KEY_ID=AKIAJ3LXMXPGC5XSH2TQ\nOTHER_KEY=AKIAZZZZZZZZZZZZZZZZ\n";
    const hits = detectSecrets(content, ".env");
    const awsHits = hits.filter((h) => h.patternId === "aws-access-key");
    assert.equal(awsHits.length, 2);
    assert.notEqual(awsHits[0]?.valueHash, awsHits[1]?.valueHash);

    const repeated = detectSecrets("AWS_ACCESS_KEY_ID=AKIAJ3LXMXPGC5XSH2TQ\n", ".env");
    assert.equal(repeated[0]?.valueHash, awsHits[0]?.valueHash, "same secret must hash identically");
  });

  it("finds two distinct secrets of the same detector in one file (no location collapse)", () => {
    const content = "AWS_ACCESS_KEY_ID=AKIAJ3LXMXPGC5XSH2TQ\nOTHER=AKIAZZZZZZZZZZZZZZZZ\n";
    const hits = detectSecrets(content, ".env");
    const awsHits = hits.filter((h) => h.patternId === "aws-access-key");
    assert.equal(awsHits.length, 2, "both distinct AWS keys must be reported");
    assert.notEqual(awsHits[0]?.index, awsHits[1]?.index);
  });
});
