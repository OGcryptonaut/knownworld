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

export interface EnrichmentCard {
  tg_id: number;
  name: string;
  /** definite ?? inferred at enrich time (what we believed going in) */
  db_company: string | null;
  linkedin_url: string | null;
  location: string | null;
  current_employer: string | null;
  /** name recovered from footprint for unnamed rows; applied only on approval */
  resolved_name: string | null;
  footprint: string[];
  /** from Gemini Google Search grounding metadata */
  citations: EnrichmentEvidence[];
  /** computed IN CODE by comparing evidence to the DB — never by the model */
  verdict: 'match' | 'possible_mismatch' | 'unverified';
  verdict_reason: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  run_id: string;
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
