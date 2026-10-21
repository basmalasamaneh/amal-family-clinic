import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { ListWaitlistResponse, CreateWaitlistEntryResponse, CheckWaitlistOfferResponse, DecideWaitlistOfferResponse } from "@workspace/api-zod";
import { authenticate, csrf, requireRoles } from "../lib/auth";
import { checkWaitlistOffer, createWaitlistEntry, decideWaitlistOffer, listWaitlist } from "../waitlist/service";

const router: IRouter = Router();
const id = z.coerce.number().int().positive().max(2147483647);
function checked<T>(schema: { parse: (value: unknown) => unknown }, value: T): T { schema.parse(value); return value; }
router.use("/waitlist", authenticate, requireRoles("front-desk"), (_req, res, next) => {
  res.set("Cache-Control", "private, no-store"); next();
});
router.get("/waitlist", async (req, res) => { res.json(checked(ListWaitlistResponse, await listWaitlist(req.auth!))); });
router.post("/waitlist/entries", csrf, async (req, res) => {
  res.status(201).json(checked(CreateWaitlistEntryResponse, await createWaitlistEntry(req.auth!, req.body)));
});
router.post("/waitlist/offers/:id/check", csrf, async (req, res) => {
  res.json(checked(CheckWaitlistOfferResponse, await checkWaitlistOffer(req.auth!, id.parse(req.params.id), req.body)));
});
router.post("/waitlist/offers/:id/decision", csrf, async (req, res) => {
  res.json(checked(DecideWaitlistOfferResponse, await decideWaitlistOffer(req.auth!, id.parse(req.params.id), req.body)));
});
export default router;
