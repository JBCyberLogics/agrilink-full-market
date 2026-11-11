const RESTRICTED_CLAIMS = [
  ['organic', /\borganic(?:ally)?\b/i],
  ['certified', /\bcertified\b/i],
  ['pesticide claim', /\b(?:pesticide[- ]free|no pesticides|zero pesticides)\b/i],
  ['chemical-free claim', /\bchemical[- ]free\b/i],
  ['grade claim', /\bgrade\s*[a-f1-5]\b/i],
  ['health/safety claim', /\b(?:disease[- ]free|safe to eat|non[- ]toxic)\b/i],
]

/** Flag factual listing claims newly introduced by a proposed rewrite. */
export function auditListingRewrite(original = {}, proposed = {}) {
  const source = `${original.title ?? original.existingTitle ?? ''} ${original.description ?? ''} ${original.qualityDetails ?? ''}`.trim()
  const rewrite = `${proposed.title ?? proposed.improvedTitle ?? ''} ${proposed.description ?? proposed.improvedDescription ?? ''}`.trim()
  if (!source || !rewrite) return { safe: false, warnings: ['Original listing content and proposed rewrite are both required.'] }
  const warnings = []
  for (const [label, pattern] of RESTRICTED_CLAIMS) {
    if (pattern.test(rewrite) && !pattern.test(source)) warnings.push(`Review the newly introduced ${label}; it was not present in the source listing.`)
  }
  const sourceNumbers = new Set(source.match(/\b\d+(?:\.\d+)?\s*(?:kg|g|tonnes?|lit(?:er|re)s?|crates?|trays?|bunches?)?\b/gi)?.map((value) => value.toLocaleLowerCase()) ?? [])
  const addedQuantities = (rewrite.match(/\b\d+(?:\.\d+)?\s*(?:kg|g|tonnes?|lit(?:er|re)s?|crates?|trays?|bunches?)?\b/gi) ?? [])
    .filter((value) => !sourceNumbers.has(value.toLocaleLowerCase()))
  if (addedQuantities.length) warnings.push(`Verify newly introduced quantity/measurement details: ${[...new Set(addedQuantities)].join(', ')}.`)
  return { safe: warnings.length === 0, warnings, sourceProvided: Boolean(source), reviewed: Boolean(rewrite) }
}
