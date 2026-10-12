import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { requireAction, requireAuth } from "../middleware/auth.middleware";
import { recordAudit } from "../services/audit.service";
import {
  actorOrganizationId,
  chunkDocument,
  documentScope,
  generateAnswer,
  hashDocument,
  retrieveKnowledge,
} from "../services/knowledge.service";

const router = Router();
router.use(requireAuth);

router.get("/documents", requireAction("manageKnowledgeDocuments"), async (req, res) => {
  const organizationId = await actorOrganizationId(req.session!.userId);
  const documents = await prisma.knowledgeDocument.findMany({
    where: documentScope(organizationId),
    select: {
      id: true,
      title: true,
      originalFileName: true,
      mimeType: true,
      status: true,
      itemId: true,
      approvedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(documents);
});

router.post(
  "/documents",
  requireAction("manageKnowledgeDocuments"),
  async (req, res) => {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const originalFileName =
      typeof req.body?.originalFileName === "string"
        ? req.body.originalFileName.trim()
        : "";
    const mimeType =
      typeof req.body?.mimeType === "string" ? req.body.mimeType.trim() : "";
    const sourceText =
      typeof req.body?.sourceText === "string" ? req.body.sourceText : "";
    const itemId =
      req.body?.itemId === undefined || req.body.itemId === ""
        ? null
        : Number(req.body.itemId);
    if (!title || !originalFileName || !mimeType || !sourceText) {
      res.status(400).json({ error: "Title, file name, MIME type, and extracted text are required" });
      return;
    }
    if (!["text/plain", "text/markdown", "application/pdf"].includes(mimeType)) {
      res.status(400).json({ error: "Unsupported document type" });
      return;
    }
    if (itemId !== null && !Number.isInteger(itemId)) {
      res.status(400).json({ error: "Invalid item id" });
      return;
    }
    let chunks;
    try {
      chunks = chunkDocument(sourceText);
    } catch {
      res.status(400).json({ error: "Document text is empty or too large" });
      return;
    }
    const organizationId = await actorOrganizationId(req.session!.userId);
    if (itemId !== null && !(await prisma.item.findUnique({ where: { id: itemId } }))) {
      res.status(400).json({ error: "Item not found" });
      return;
    }
    try {
      const document = await prisma.$transaction(async (tx) => {
        const created = await tx.knowledgeDocument.create({
          data: {
            title,
            originalFileName,
            mimeType,
            sourceText,
            contentHash: hashDocument(sourceText),
            organizationId,
            itemId,
            uploadedById: req.session!.userId,
            status: "REVIEW_REQUIRED",
            chunks: { create: chunks },
          },
          include: { _count: { select: { chunks: true } } },
        });
        await recordAudit(
          {
            actorId: req.session!.userId,
            action: "knowledge_document.upload",
            entityType: "KnowledgeDocument",
            entityId: created.id,
            after: { id: created.id, status: created.status, chunkCount: created._count.chunks },
          },
          tx
        );
        return created;
      });
      res.status(201).json(document);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        res.status(409).json({ error: "This document has already been uploaded" });
        return;
      }
      throw error;
    }
  }
);

router.post(
  "/documents/:id/approve",
  requireAction("approveKnowledgeDocuments"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid document id" });
      return;
    }
    const organizationId = await actorOrganizationId(req.session!.userId);
    const document = await prisma.knowledgeDocument.findFirst({
      where: { id, ...documentScope(organizationId) },
    });
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const approved = await prisma.$transaction(async (tx) => {
      const result = await tx.knowledgeDocument.update({
        where: { id },
        data: { status: "APPROVED", approvedById: req.session!.userId, approvedAt: new Date() },
      });
      await recordAudit(
        {
          actorId: req.session!.userId,
          action: "knowledge_document.approve",
          entityType: "KnowledgeDocument",
          entityId: id,
          before: { status: document.status },
          after: { status: result.status },
        },
        tx
      );
      return result;
    });
    res.json(approved);
  }
);

router.post(
  "/assistant/query",
  requireAction("useKnowledgeAssistant"),
  async (req, res) => {
    if (process.env.AI_ENABLED !== "true" && process.env.AI_ALLOW_RETRIEVAL_ONLY !== "true") {
      res.status(503).json({ status: "UNAVAILABLE", error: "Knowledge assistant is disabled" });
      return;
    }
    const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
    const itemId = req.body?.itemId === undefined ? undefined : Number(req.body.itemId);
    if (!question || question.length > 2000 || (itemId !== undefined && !Number.isInteger(itemId))) {
      res.status(400).json({ error: "A valid question and optional item id are required" });
      return;
    }
    const organizationId = await actorOrganizationId(req.session!.userId);
    const evidence = await retrieveKnowledge(question, organizationId, itemId);
    if (evidence.length === 0) {
      res.json({ status: "INSUFFICIENT_EVIDENCE", answer: "I could not find sufficient approved documentation to answer that reliably.", citations: [] });
      return;
    }
    try {
      const result = await generateAnswer(question, evidence);
      res.json({
        status: result.provider === "none" ? "INSUFFICIENT_EVIDENCE" : "SUPPORTED",
        answer: result.answer,
        citations: evidence.map((entry) => ({
          documentId: entry.documentId,
          fileName: entry.fileName,
          pageNumber: entry.pageNumber,
          section: entry.sectionTitle ?? entry.headingPath,
          chunkId: entry.id,
        })),
      });
    } catch {
      res.status(503).json({ status: "UNAVAILABLE", error: "Knowledge assistant provider is unavailable" });
    }
  }
);

export default router;
