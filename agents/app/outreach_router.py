"""Outreach drafter + pipeline endpoints (D3). Filled by the drafter module.

Contract (mirrors web/src/lib/types.ts):
  POST  /outreach/draft   DraftRequest -> DraftResponse   (SELECTION-ONLY: the
        user picked this position+contact; 422 if the contact has a blank name
        — never draft to a nameless row)
  POST  /pipeline         {tg_id, job_id?, stage?, note?, follow_up_date?, draft_message?} -> PipelineItem
  GET   /pipeline         -> PipelineItem[]
  PATCH /pipeline/{id}    {stage?, follow_up_date?, note?, draft_message?} -> PipelineItem
"""
from fastapi import APIRouter

router = APIRouter()
