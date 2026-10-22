import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateChunkScore,
  chunkDocument,
  documentScope,
  extractQueryTerms,
  generateAnswer,
  hashDocument,
} from "../src/services/knowledge.service";
import { can } from "../src/lib/rbac";

test("hashDocument produces deterministic SHA-256 digest", () => {
  const hash1 = hashDocument("Sensor Manual v1.0 Content");
  const hash2 = hashDocument("Sensor Manual v1.0 Content");
  const hash3 = hashDocument("Different Manual Content");

  assert.equal(hash1.length, 64);
  assert.equal(hash1, hash2);
  assert.notEqual(hash1, hash3);
});

test("chunkDocument extracts pages, propagates headings, and estimates tokens", () => {
  const document = `
# Calibration Procedure
[page:1]
Ensure the calibration gas regulator is set to 0.5 L/min before opening the cylinder valve.
Connect the calibration adapter firmly to the MultiGas sensor port.

## Span Gas Calibration
[page:2]
Apply span gas containing 20.9% O2, 50 ppm CO, and 25 ppm H2S for 90 seconds.
Wait for sensor readings to stabilize within +/- 2% before confirming calibration.
`;

  const chunks = chunkDocument(document);

  assert.ok(chunks.length >= 2, "Document should be divided into chunks");
  assert.equal(chunks[0].chunkIndex, 0);
  assert.equal(chunks[0].pageNumber, 1);
  assert.equal(chunks[0].sectionTitle, "Calibration Procedure");
  assert.ok(chunks[0].tokenCount > 0);

  // Second chunk should reflect page 2 and updated heading
  const secondChunk = chunks.find((c) => c.text.includes("Span Gas Calibration") || c.text.includes("20.9% O2"));
  assert.ok(secondChunk, "Span gas chunk must exist");
  assert.equal(secondChunk?.pageNumber, 2);
  assert.equal(secondChunk?.sectionTitle, "Span Gas Calibration");
});

test("chunkDocument rejects empty and oversized documents", () => {
  assert.throws(() => chunkDocument("   "), /Document text is empty or too large/);
  assert.throws(
    () => chunkDocument("x".repeat(2_000_001)),
    /Document text is empty or too large/
  );
});

test("extractQueryTerms filters stopwords and extracts meaningful keywords", () => {
  const query = "What is the recommended flow rate for bump testing the sensor?";
  const terms = extractQueryTerms(query);

  assert.ok(!terms.includes("what"));
  assert.ok(!terms.includes("is"));
  assert.ok(!terms.includes("the"));
  assert.ok(!terms.includes("for"));
  assert.ok(terms.includes("recommended"));
  assert.ok(terms.includes("flow"));
  assert.ok(terms.includes("rate"));
  assert.ok(terms.includes("bump"));
  assert.ok(terms.includes("testing"));
  assert.ok(terms.includes("sensor"));
});

test("EVAL-1: calculateChunkScore matches in-domain query with section and phrase bonus", () => {
  const chunk = {
    text: "Ensure the calibration gas regulator is set to 0.5 L/min before opening the cylinder valve.",
    sectionTitle: "Bump Testing & Calibration",
  };

  const terms = extractQueryTerms("calibration gas regulator flow rate");
  const score = calculateChunkScore(chunk, terms, "calibration gas regulator");

  assert.ok(score >= 0.5, `Score should be high for matching terms, got ${score}`);
});

test("EVAL-3: calculateChunkScore returns 0 for out-of-domain and unanswerable queries", () => {
  const chunk = {
    text: "Ensure the calibration gas regulator is set to 0.5 L/min before opening the cylinder valve.",
    sectionTitle: "Bump Testing & Calibration",
  };

  const unrelatedTerms = extractQueryTerms("How do I replace the engine oil on an excavator?");
  const score = calculateChunkScore(chunk, unrelatedTerms, "excavator engine oil replacement");

  assert.equal(score, 0, "Out-of-domain query must receive a score of 0");
});

test("EVAL-5: documentScope enforces multi-tenant boundary and global document access", () => {
  // Global / unassigned tenant
  assert.deepEqual(documentScope(null), { organizationId: null });

  // Organization 1 scope
  const org1Scope = documentScope(1);
  assert.deepEqual(org1Scope, {
    OR: [{ organizationId: 1 }, { organizationId: null }],
  });

  // Verify that an organization 2 document would not match organization 1
  const docOrg2 = { organizationId: 2 };
  const matchesOrg1 =
    (org1Scope as any).OR.some(
      (clause: any) => clause.organizationId === docOrg2.organizationId
    );
  assert.equal(matchesOrg1, false, "Organization 1 scope must never match Organization 2 documents");
});

test("EVAL-3: generateAnswer returns INSUFFICIENT_EVIDENCE refusal when evidence is empty", async () => {
  const result = await generateAnswer("How do I replace the excavator engine oil?", []);

  assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.provider, "none");
  assert.equal(
    result.answer,
    "I could not find sufficient approved documentation to answer that reliably."
  );
});

test("EVAL-6: generateAnswer in retrieval-only mode produces formatted excerpts and citations", async () => {
  const previousAiEnabled = process.env.AI_ENABLED;
  try {
    process.env.AI_ENABLED = "false";

    const evidence = [
      {
        id: 101,
        chunkIndex: 0,
        documentId: 1,
        documentTitle: "MultiGas Pro User Manual",
        fileName: "MultiGas_Pro_Manual.pdf",
        pageNumber: 14,
        sectionTitle: "Bump Testing",
        headingPath: "Bump Testing",
        text: "Regulator must be set to 0.5 L/min.",
        score: 0.85,
      },
    ];

    const result = await generateAnswer("What is the flow rate?", evidence);

    assert.equal(result.status, "SUPPORTED");
    assert.equal(result.provider, "retrieval-only");
    assert.ok(result.answer.includes("MultiGas_Pro_Manual.pdf"));
    assert.ok(result.answer.includes("Page: 14"));
    assert.ok(result.answer.includes("Section: Bump Testing"));
    assert.ok(result.answer.includes("0.5 L/min"));
  } finally {
    process.env.AI_ENABLED = previousAiEnabled;
  }
});

test("RBAC permissions guard document management and assistant querying", () => {
  // Assistant query is accessible to all operational roles
  assert.equal(can("ADMIN", "useKnowledgeAssistant"), true);
  assert.equal(can("STORE_MANAGER", "useKnowledgeAssistant"), true);
  assert.equal(can("ACCOUNTS", "useKnowledgeAssistant"), true);
  assert.equal(can("VIEWER", "useKnowledgeAssistant"), true);

  // Document management & approval is restricted to ADMIN and STORE_MANAGER
  assert.equal(can("ADMIN", "manageKnowledgeDocuments"), true);
  assert.equal(can("ADMIN", "approveKnowledgeDocuments"), true);
  assert.equal(can("STORE_MANAGER", "manageKnowledgeDocuments"), true);
  assert.equal(can("STORE_MANAGER", "approveKnowledgeDocuments"), true);
  assert.equal(can("ACCOUNTS", "manageKnowledgeDocuments"), false);
  assert.equal(can("VIEWER", "manageKnowledgeDocuments"), false);
  assert.equal(can("VIEWER", "approveKnowledgeDocuments"), false);
});

