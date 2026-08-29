"""Job scout endpoints (D2). Filled in by the jobs module.

Contract (mirrors web/src/lib/types.ts):
  POST /jobs/run   {profile: RoleFitProfile} -> JobsRunSummary  (dedupe companies -> ATS feeds -> role-fit filter)
  GET  /jobs?fit=1 -> JobPosting[] (contacts joined from people, ranked by closeness)
  GET  /jobs/summary -> latest JobsRunSummary
"""
from fastapi import APIRouter

router = APIRouter()
