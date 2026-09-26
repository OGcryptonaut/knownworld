// The data boundary as DATA — the single source the public /privacy page and
// the in-app DataBoundaryIndicator render from. No React in this file.
//
// Four tiers, in the order they should be shown:
//   browser   "In this browser only"   — never leaves the device
//   transient "Sent, not kept"         — crosses the wire, exists only for the request
//   stored    "Stored in your account" — persisted, visible, editable, deletable
//   never     "Never"                  — what the architecture rules out
//
// Every item names WHERE it lives or goes, WHY, and (when there is one) the
// file that enforces it, so the UI can link "proof". codeRef is a repo path,
// optionally followed by a space and the function/section. The stored tier
// mirrors agents/app/inventory.py collection for collection —
// __tests__/boundary.test.ts cross-checks the two.
//
// Wording rule (verified in code, see docs/HANDOFF): the honest claim is
// "we never store a message", NOT "messages never leave the browser". Distill
// batches DO pass through the agents service in memory on their way to
// Gemini. Say so.

export type BoundaryTier = 'browser' | 'transient' | 'stored' | 'never';

export const TIER_LABELS: Record<BoundaryTier, string> = {
  browser: 'In this browser only',
  transient: 'Sent, not kept',
  stored: 'Stored in your account',
  never: 'Never',
};

export const TIER_ORDER: readonly BoundaryTier[] = ['browser', 'transient', 'stored', 'never'];

/** Which switch removes a stored item (mirrors inventory.py wiped_by). */
export type WipedBy = 'DELETE /data' | 'delete-account' | 'never';

export interface BoundaryItem {
  /** What the data is, in the user's words. */
  item: string;
  /** Where it lives, or where it goes and for how long. */
  where: string;
  /** Why it exists / why this tier. */
  why: string;
  /** Repo path (+ optional " function") of the code that enforces it. */
  codeRef?: string;
  /** Stored tier only: the Firestore collections under users/{uid} (or root). */
  collections?: readonly string[];
  /** Stored tier only: which switch removes it. */
  wipedBy?: WipedBy;
}

export interface BoundaryTierInfo {
  id: BoundaryTier;
  label: string;
  /** One line under the label. */
  summary: string;
  items: readonly BoundaryItem[];
}

// numbers the transient tier states — kept in sync with lib/types.ts
import { MAX_CHAT_CHARS, REFINE_BATCH_SIZE } from './types';

export const BOUNDARY_TIERS: readonly BoundaryTierInfo[] = [
  {
    id: 'browser',
    label: TIER_LABELS.browser,
    summary: 'Parsed and kept on this device. Nothing here is uploaded.',
    items: [
      {
        item: 'Your Telegram export (result.json)',
        where: 'Read by a Web Worker in this tab, chat by chat, into IndexedDB.',
        why: 'The file is too large to upload sensibly and there is no reason to: distilling works on small excerpts.',
        codeRef: 'web/src/workers/ingest.worker.ts',
      },
      {
        item: 'Every message, in full',
        where: "This browser's IndexedDB (database 'knownworld', stores chats / messages / meta).",
        why: 'The only copy the app ever has. Clearing site data or "Delete everything" removes it.',
        codeRef: 'web/src/lib/db.ts',
      },
      {
        item: 'Closeness scores',
        where: 'Computed in code at ingest from message counts and recency; echoed to the server as a number.',
        why: 'A model never decides how close you are to someone. Values a model sneaks in are dropped.',
        codeRef: 'web/src/lib/closeness.ts',
      },
      {
        item: 'Wizard progress, theme, and the "Mask names" switch',
        where: 'localStorage on this device.',
        why: 'Per-device conveniences. Masking is display-only and never changes stored names.',
        codeRef: 'web/src/lib/privacy.ts',
      },
    ],
  },
  {
    id: 'transient',
    label: TIER_LABELS.transient,
    summary: 'Crosses the wire for one request, is used, and is discarded. Never written, never logged.',
    items: [
      {
        item: 'Distill batches',
        where: `Up to ${REFINE_BATCH_SIZE} chats per request, each capped at ${MAX_CHAT_CHARS.toLocaleString('en-US')} characters of the most recent text — through the same-origin /agents proxy to the agents service, on to Gemini, held in memory for the request only.`,
        why: 'The model reads a small excerpt to write one two-line summary per contact. Only the distilled rows and per-call telemetry are saved; the batch is gone when the response is sent.',
        codeRef: 'agents/app/main.py refine_batch',
      },
      {
        item: 'Research query',
        where: 'A contact\'s name and believed company to Gemini with Google Search grounding.',
        why: 'Public-evidence research needs a name to search for. The result comes back as a card with citations; the verdict is computed in code.',
        codeRef: 'agents/app/agents/enrich.py build_search_query',
      },
      {
        item: 'Your question in Ask',
        where: 'The question, verbatim, plus the candidate contact cards it is matched against (name, company, role, summary, research card — never messages) to Gemini. When the question needs the live web: the question plus up to 8 name/company pairs to Gemini with Google Search grounding.',
        why: 'Matching and briefs are grounded on what the contact card shows and nothing more; hallucinated contacts are dropped in code.',
        codeRef: 'agents/app/requests_router.py _execute_people',
      },
      {
        item: 'Intro and outreach drafts',
        where: "A contact's first name, their two-line summary, the closeness number and the posting's title + company to Gemini.",
        why: 'The draft is returned for you to copy into Telegram yourself. The app never sends anything.',
        codeRef: 'agents/app/outreach_router.py',
      },
      {
        item: 'Company names in the job scout',
        where: 'Company slugs to public ATS boards (Greenhouse, Lever, Ashby, Workable, SmartRecruiters).',
        why: 'Fetching public postings needs the company, never a person.',
        codeRef: 'agents/app/jobs/ats.py',
      },
      {
        item: 'Google sign-in token',
        where: "The ID token from Google's button, verified once against Google's keys.",
        why: 'Only the verified email is kept, as your account address.',
        codeRef: 'agents/app/auth_router.py _verify_google_credential',
      },
    ],
  },
  {
    id: 'stored',
    label: TIER_LABELS.stored,
    summary: 'Persisted in your own tenant. Everything here is visible in the app, editable, and removed by one switch.',
    items: [
      {
        item: 'Contacts',
        where: 'One row per contact: name, company (definite and inferred, never merged), role guess, the model-written two-line summary, closeness and message volume, research-applied fields, your edits and note.',
        why: 'This is the map. Rows you correct are marked verified by you and never overwritten by a model.',
        codeRef: 'agents/app/store.py',
        collections: ['people'],
        wipedBy: 'DELETE /data',
      },
      {
        item: 'Research cards',
        where: 'Per contact: current employer, location (with map coordinates), links, focus, history, footprint, tags, the citations behind them, the code-computed verdict, and a dated changelog.',
        why: 'Built from public evidence so you can see why the app believes what it believes.',
        codeRef: 'agents/app/enrich_store.py',
        collections: ['enrichments'],
        wipedBy: 'DELETE /data',
      },
      {
        item: 'Asks',
        where: 'Each question verbatim, the parsed intent, and a snapshot of the answer at the time: matched contacts, postings, web findings with sources, brief sections, or the drafted intro.',
        why: 'Re-asking later is the point: feeds move, the network moves. The snapshot is what you saw.',
        codeRef: 'agents/app/requests_store.py',
        collections: ['requests'],
        wipedBy: 'DELETE /data',
      },
      {
        item: 'Tracked leads and drafts',
        where: 'The contact, company, posting, stage, follow-up date, your note, and the copy-out draft.',
        why: 'Your pipeline. Untrack one lead any time; the contact stays.',
        codeRef: 'agents/app/pipeline_store.py',
        collections: ['pipeline'],
        wipedBy: 'DELETE /data',
      },
      {
        item: 'Activity log',
        where: 'Per agent call: agent, resolved model id, tokens, estimated cost, duration, status, a one-line detail. Counts and ids only.',
        why: 'Proof of which model ran and what it cost. Never prompt or message content.',
        codeRef: 'agents/app/store.py',
        collections: ['activity_log'],
        wipedBy: 'DELETE /data',
      },
      {
        item: 'Job postings and scout runs',
        where: 'Public postings from the feeds of companies in your network, joined in code to the contacts you know there, plus one summary per run.',
        why: 'The warm path to a posting is the contact next to it.',
        codeRef: 'agents/app/jobs_store.py',
        collections: ['jobs', 'job_runs'],
        wipedBy: 'DELETE /data',
      },
      {
        item: 'Your account',
        where: 'uid, email, a scrypt password hash and salt (empty until a Google-created account sets one), created_at — and an email-to-uid index.',
        why: 'The account is the tenant: every row above lives under it. "Delete everything" keeps it; "Delete account" removes it and the tenant in one go.',
        codeRef: 'agents/app/users.py',
        collections: ['users', 'email_index'],
        wipedBy: 'delete-account',
      },
      {
        item: 'ATS feed cache (shared)',
        where: 'A company-to-job-board mapping, verified live, shared across accounts — not inside your tenant.',
        why: 'Public knowledge with no personal data; sharing it saves probing the same boards again.',
        codeRef: 'agents/app/jobs_store.py',
        collections: ['ats_slugs'],
        wipedBy: 'never',
      },
    ],
  },
  {
    id: 'never',
    label: TIER_LABELS.never,
    summary: 'Ruled out by the architecture, not by a promise.',
    items: [
      {
        item: 'A message stored on a server',
        where: 'Nowhere. The refine endpoint persists distilled rows and telemetry only; the agents service has no request logging.',
        why: 'The batch exists inside one request and the model call, then it is gone.',
        codeRef: 'agents/app/main.py refine_batch',
      },
      {
        item: 'Your export file uploaded',
        where: 'Nowhere. It is streamed in this tab into IndexedDB.',
        why: 'Only small excerpts ever leave, in distill batches.',
        codeRef: 'web/src/workers/ingest.worker.ts',
      },
      {
        item: 'A message sent on your behalf',
        where: 'No channel is connected. Drafts are copy-out only.',
        why: 'You paste it into Telegram yourself, or you do not.',
        codeRef: 'agents/app/outreach_router.py',
      },
      {
        item: 'Closeness decided by a model',
        where: 'Computed in code at ingest; model-returned values are ignored in the merge step.',
        why: 'How close you are to someone is arithmetic on your own history, not an opinion.',
        codeRef: 'agents/app/main.py refine_batch',
      },
      {
        item: 'Trackers',
        where: 'No analytics, no advertising scripts. One cookie: your sign-in session (kw_session, httpOnly). The optional Google sign-in button loads Google\'s script on the login page only.',
        why: 'There is nothing to measure that needs a third party.',
        codeRef: 'web/src/proxy.ts',
      },
      {
        item: 'Training on your data',
        where: "Model calls run on Vertex AI, whose terms exclude API prompts and responses from training Google's models.",
        why: 'The paid tier is the whole reason to route through Vertex rather than a consumer API.',
        codeRef: 'agents/app/config.py',
      },
    ],
  },
];

export function tier(id: BoundaryTier): BoundaryTierInfo {
  const found = BOUNDARY_TIERS.find((t) => t.id === id);
  if (!found) throw new Error(`unknown boundary tier ${id}`);
  return found;
}

/** Every collection the stored tier claims to cover (for the cross-check). */
export function storedCollections(): string[] {
  return tier('stored').items.flatMap((i) => [...(i.collections ?? [])]);
}

// ---- hosted vs self-deploy --------------------------------------------------
//
// The transient tier is where the two deployments differ: on a hosted
// instance the OPERATOR could, in principle, observe a batch in flight; on a
// self-deploy nobody else is in the loop. NEXT_PUBLIC_DEPLOYMENT is inlined
// at build time (deploy.sh sets it). Unset or unknown -> 'hosted': the
// conservative claim is the honest default.

export type Deployment = 'hosted' | 'self';

export function deploymentMode(
  raw: string | undefined = process.env.NEXT_PUBLIC_DEPLOYMENT,
): Deployment {
  return (raw ?? '').trim().toLowerCase() === 'self' ? 'self' : 'hosted';
}

export interface DeploymentNote {
  title: string;
  body: string;
}

export const DEPLOYMENT_NOTES: Record<Deployment, DeploymentNote> = {
  hosted: {
    title: 'This is a hosted instance',
    body:
      'Distill batches and research queries pass through our agents service in memory on their way to Gemini. Nothing is written or logged — but the operator of this deployment could, in principle, observe a batch in flight. If that is not acceptable, self-deploy: one script stands the whole stack up in your own Google Cloud project, and then nobody else is in the loop.',
  },
  self: {
    title: 'This is a self-deployed instance',
    body:
      'It runs in your own Google Cloud project. Batches pass through your own agents service to Gemini in memory; nobody else is in the loop, and the delete switches act on your own Firestore.',
  },
};

export function deploymentNote(mode: Deployment = deploymentMode()): DeploymentNote {
  return DEPLOYMENT_NOTES[mode];
}
