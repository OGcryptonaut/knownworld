// Shared contracts — single source of truth for data shapes across
// ingest (browser-only) → IndexedDB → refine batches (transient) →
// distilled rows (Firestore, via the agents service).

export const MAX_STORED_MESSAGES = 300; // per chat, most recent, text-only
export const MAX_CHAT_CHARS = 12_000;   // per chat cap inside a refine batch
export const REFINE_BATCH_SIZE = 20;    // chats per batch (SPEC)

export interface NormalizedMessage {
  fromMe: boolean;
  date: string; // ISO
  text: string; // flattened plain text; service/media entries dropped
}

export interface ChatMeta {
  id: number;
  name: string; // real name as exported — masked only at render time
  type:
    | 'personal_chat'
    | 'private_group'
    | 'private_supergroup'
    | 'saved_messages'
    | 'bot_chat'
    | string;
  msgCount: number;
  myCount: number;
  theirCount: number;
  firstDate: string | null;
  lastDate: string | null;
  /** 0..100 — computed in code from volume+recency at ingest. NEVER by a model. */
  closeness: number;
  storedCount: number; // messages retained in IndexedDB after capping
}

export interface StoredChatMessages {
  chatId: number;
  messages: NormalizedMessage[];
}

export interface IngestSummary {
  fileName: string;
  fileSize: number;
  ingestedAt: string;
  totalChats: number;
  totalMessages: number;
  personalChats: number;
  detectedMyId: string | null;
  /** text-bearing messages actually kept — 0 means nothing to distill
   *  (optional: summaries stored by older builds lack it) */
  storedMessages?: number;
}

export interface IngestProgress {
  phase: 'parsing' | 'storing' | 'done' | 'error';
  bytesRead: number;
  bytesTotal: number;
  chatsSeen: number;
  messagesSeen: number;
  error?: string;
}

// ---- Refine (browser → agents service; batch is TRANSIENT server-side) ----

export interface RefineChatPayload {
  tg_id: number;
  name: string;
  my_msg_count: number;
  their_msg_count: number;
  last_message_iso: string | null;
  /** code-computed; passed through so the service can persist it — never model-derived */
  closeness: number;
  messages: { from_me: boolean; date: string; text: string }[];
}

export interface RefineBatchRequest {
  run_id: string;
  batch_index: number;
  batch_count: number;
  chats: RefineChatPayload[];
}

export interface DistilledPerson {
  tg_id: number;
  name: string;
  company_definite: string | null; // only if stated in chats — NEVER merged with inferred
  company_inferred: string | null;
  role_guess: string | null;
  summary: string; // <= 2 lines
  work_relevant: boolean;
  why_relevant: string;
  closeness: number; // echoed from request (code-computed)
  msg_volume: number;
  last_contact: string | null;
  run_id: string;
  refined_at: string;
  /** 'owner' after an inline correction — the human fence; else latest verdict */
  verified?: string | null;
  /** Owner's Assessment — written only via Edit, never by a machine */
  owner_note?: string | null;
  /** evidence location merged onto the row (enrichment / owner edit) */
  location?: string | null;
}

export interface ActivityEntry {
  ts: string;
  agent: 'refine' | 'enrich' | 'jobscout' | 'drafter' | string;
  model: string; // resolved model id — compliance proof
  run_id: string;
  batch_index?: number;
  input_tokens: number;
  output_tokens: number;
  est_cost_usd: number;
  duration_ms: number;
  status: 'ok' | 'rejected' | 'error';
  detail?: string;
}

export interface RefineBatchResponse {
  people: DistilledPerson[];
  rejected: { reason: string }[];
  activity: ActivityEntry;
}

export interface RefineRunState {
  runId: string;
  totalBatches: number;
  completedBatches: number[];
  peopleFound: number;
  startedAt: string;
  status: 'running' | 'paused' | 'done' | 'error';
}

// ---- Role-fit profile (onboarding) ----
export interface RoleFitProfile {
  targetRoles: string[];
  industries: string[];
  seniority: string[];
  location: string;
}

export const DEFAULT_ROLE_FIT: RoleFitProfile = {
  targetRoles: ['BD lead', 'partnerships', 'ecosystem/growth lead', 'GTM', 'grants/program lead'],
  industries: ['L1/L2s', 'stablecoins & payments', 'exchanges', 'infra', 'DeFi'],
  seniority: ['senior', 'lead', 'head', 'director'],
  location: 'remote EMEA or Lisbon',
};

// ---- D2: Enrich + verify ----

export interface EnrichmentEvidence {
  title: string;
  url: string;
  snippet?: string;
}

export interface ChangedField {
  field: string;
  old?: string | null;
  new?: string | null;
}

/** one re-research pass: when, what changed (old -> new), its citations */
export interface CardUpdate {
  at: string;
  changed: ChangedField[];
  citations: EnrichmentEvidence[];
}

export interface EnrichmentCard {
  tg_id: number;
  name: string;
  /** definite ?? inferred at enrich time (what we believed going in) */
  db_company: string | null;
  linkedin_url: string | null;
  location: string | null;
  /** approximate city-center coordinates for the map view; null without a location */
  location_lat?: number | null;
  location_lng?: number | null;
  current_employer: string | null;
  /** what they do now / how they can help — extracted from public evidence */
  current_focus?: string | null;
  how_useful?: string | null;
  /** employment history lines, newest first: "YEARS — ORG — ROLE" */
  history?: string[];
  /** name recovered from footprint for unnamed rows; auto-applied to blank rows */
  resolved_name: string | null;
  footprint: string[];
  /** canonical research-created tags (agents/app/tags.py funnel); when
   *  present they win over the client-side regex fallback */
  tags?: string[];
  /** from Gemini Google Search grounding metadata */
  citations: EnrichmentEvidence[];
  /** computed IN CODE by comparing evidence to the DB — never by the model */
  verdict: 'match' | 'possible_mismatch' | 'unverified';
  verdict_reason: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  run_id: string;
  /** 'owner' when corrected/confirmed inline — clears the mismatch/unverified flag */
  verified_by?: string | null;
  /** dated changelog of re-research passes, newest first */
  updates?: CardUpdate[];
}

// ---- D2: Job scout ----

export type AtsSource = 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'smartrecruiters';

export interface JobContactRef {
  tg_id: number;
  name: string;
  closeness: number;
}

export interface JobPosting {
  id: string; // `${source}:${slug}:${job_id}`
  company: string;
  slug: string;
  source: AtsSource;
  title: string;
  location: string | null;
  url: string;
  role_fit: boolean;
  fit_reasons: string[];
  posted_at: string | null;
  fetched_at: string;
  contacts: JobContactRef[]; // ranked by closeness desc
}

export interface JobsRunSummary {
  run_id: string;
  companies_total: number;
  companies_with_slug: number;
  postings_total: number;
  postings_fit: number;
  started_at: string;
  status: 'running' | 'done' | 'error';
}

// D2: enrichment fields merged onto DistilledPerson on card approval
export interface DistilledPersonEnriched extends DistilledPerson {
  linkedin_url?: string | null;
  location?: string | null;
  current_employer?: string | null;
  verified?: string | null;
}

// ---- D3: Outreach drafter (selection-only) + pipeline ----

export interface DraftRequest {
  tg_id: number;
  job_id: string; // JobPosting.id
}

export interface DraftResponse {
  message: string; // the warm outreach draft — user copies it into Telegram themselves
  grounded_on: { summary: string; closeness: number; title: string; company: string };
  activity: ActivityEntry;
}

export type PipelineStage = 'lead' | 'outreach' | 'referred' | 'interview' | 'offer' | 'closed';
export const PIPELINE_STAGES: PipelineStage[] = ['lead', 'outreach', 'referred', 'interview', 'offer', 'closed'];

export interface PipelineItem {
  id: string;
  tg_id: number;
  contact_name: string; // masked at render
  company: string;
  job_id: string | null;
  job_title: string | null;
  job_url: string | null;
  stage: PipelineStage;
  follow_up_date: string | null; // ISO date; overdue when < today and stage not offer/closed
  note: string;
  draft_message: string | null;
  created_at: string;
  updated_at: string;
}

// ---- v2: auth + requests ----

export interface SessionUser {
  uid: string;
  email: string;
}

/** Mirrors agents/app/requests_store.py — field-for-field. */
export interface RequestPeopleMatch {
  tg_id: number;
  name: string; // masked at render
  company: string | null;
  role_guess: string | null;
  closeness: number;
  /** one line, grounded in the distilled row — model output, tg_id validated in code */
  reason: string;
}

export interface RequestResult {
  kind: 'jobs' | 'people' | 'intro' | 'brief';
  /** the agent's short chat reply: composed in code for jobs (honest stats
   *  prose), written by the matcher for people (schema-enforced) — or by
   *  the web scout when the question needed fresh public facts */
  answer?: string | null;
  /** grounded-search citations backing a web-scout answer */
  sources?: { title: string; url: string }[];
  /** web-scout findings as structured linkable cards; related = names of
   *  the user's own contacts involved (resolved server-side) */
  findings?: { title: string; detail: string; url: string | null; related: string[] }[];
  /** brief intent: the composed deliverable's titled sections */
  sections?: { title: string; body: string }[];
  /** intro intent: the drafted copy-out message and who it addresses */
  message?: string | null;
  intro_to?: RequestPeopleMatch | null;
  postings: JobPosting[];
  matches: RequestPeopleMatch[];
  /** honest execution stats: windows applied, rows dropped, truncation */
  stats: Record<string, number | string | boolean | null>;
}

export interface UserRequest {
  id: string;
  query: string;
  intent: 'jobs' | 'people' | 'intro' | 'brief' | null;
  /** planner's one-line interpretation of the query */
  note: string | null;
  params: Record<string, unknown>;
  status: 'running' | 'done' | 'rejected' | 'error';
  error: string | null;
  rejected_reasons: string[];
  result: RequestResult | null;
  created_at: string;
  finished_at: string | null;
  /** follow-ups share the first request's id; null (old docs) = own thread */
  thread_id?: string | null;
}
