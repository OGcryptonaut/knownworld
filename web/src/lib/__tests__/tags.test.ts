// Closed tag vocabulary: deterministic, code-computed, capped. Synthetic data.

import { describe, expect, it } from 'vitest';
import { TAG_RULES, deriveTags } from '../tags';

describe('deriveTags', () => {
  it('matches tags from any of the given text fields', () => {
    expect(deriveTags(['Founder & CEO', null, 'runs a rocket company'])).toEqual([
      'founder',
      'hardware',
    ]);
  });

  it('keeps TAG_RULES order regardless of text order', () => {
    const tags = deriveTags(['crypto payments engineer, ex-founder']);
    expect(tags).toEqual(['founder', 'engineering', 'crypto', 'payments']);
  });

  it('caps at five tags', () => {
    const everything = TAG_RULES.map((r) => r.tag).join(' ');
    // feed words that trip many rules at once
    expect(
      deriveTags([everything, 'founder ceo engineer product bd investor marketing design']),
    ).toHaveLength(5);
  });

  it('returns nothing for empty or blank input', () => {
    expect(deriveTags([])).toEqual([]);
    expect(deriveTags([null, undefined, '  '])).toEqual([]);
  });

  it('is deterministic', () => {
    const input = ['Head of Partnerships', 'stablecoin infra'];
    expect(deriveTags(input)).toEqual(deriveTags(input));
  });
});
