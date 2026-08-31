// Closed tag vocabulary, computed IN CODE from a row's own text fields
// (atlas-crm idea: tags are a fixed, deterministic set — a model never
// invents them). Order in TAG_RULES is the display order everywhere.

export const TAG_RULES: { tag: string; pattern: RegExp }[] = [
  { tag: 'founder', pattern: /\bfounder|\bceo\b/i },
  { tag: 'exec', pattern: /\bchairman|\bpresident\b|\bcoo\b|\bcfo\b|\bchief\b/i },
  { tag: 'engineering', pattern: /\bengineer|\bcto\b|developer|technical/i },
  { tag: 'product', pattern: /\bproduct\b/i },
  { tag: 'bizdev', pattern: /\bbd\b|business development|partnership/i },
  { tag: 'investor', pattern: /\binvestor|\bvc\b|venture|angel\b/i },
  { tag: 'marketing', pattern: /marketing|\bgrowth\b|community/i },
  { tag: 'design', pattern: /\bdesign/i },
  { tag: 'research', pattern: /research|scientist/i },
  { tag: 'ops', pattern: /operations|\bops\b|chief of staff/i },
  { tag: 'ai', pattern: /\bai\b|artificial intelligence|machine learning|\bml\b|\bllm/i },
  { tag: 'crypto', pattern: /crypto|blockchain|web3|\bdefi\b|stablecoin|\btokens?\b/i },
  { tag: 'payments', pattern: /payment|fintech|banking/i },
  { tag: 'hardware', pattern: /hardware|robotics|aerospace|rocket|chip\b|semiconductor/i },
  { tag: 'security', pattern: /security|infosec|pentest/i },
  { tag: 'media', pattern: /\bmedia\b|journalist|newsletter|podcast/i },
  { tag: 'hiring', pattern: /recruit|hiring|talent\b/i },
];

const MAX_TAGS = 5;

/** Deterministic tags for one contact from its visible text fields. */
export function deriveTags(texts: (string | null | undefined)[]): string[] {
  const hay = texts.filter(Boolean).join(' ');
  if (hay.trim() === '') return [];
  const out: string[] = [];
  for (const { tag, pattern } of TAG_RULES) {
    if (pattern.test(hay)) {
      out.push(tag);
      if (out.length >= MAX_TAGS) break;
    }
  }
  return out;
}
