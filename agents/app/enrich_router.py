"""Enrich + verify endpoints (D2). Filled in by the enrich module.

Contract (mirrors web/src/lib/types.ts):
  POST /enrich/person       {tg_id, db_company_override?} -> EnrichmentCard (sync, one person)
  POST /enrich/run          {tg_ids?: [int], top?: int}   -> {run_id, queued}  (via TaskQueue)
  POST /enrich/task         internal Cloud Tasks/local handler, one person per call
  GET  /enrichments?status= -> EnrichmentCard[]
  POST /enrichments/{tg_id}/approve  {set_company_definite?: bool, corrections?} -> updated person
  POST /enrichments/{tg_id}/reject   -> card rejected, person marked unverified
"""
from fastapi import APIRouter

router = APIRouter()
