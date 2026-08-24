// Keyword-based probe matching. Crude but free — checks whether each
// `should_flag` probe was caught by ANY finding (matching ≥ N keywords)
// and whether any `should_not_flag` was incorrectly raised.
//
// This is intentionally simple. Future enhancement: LLM-judge mode that
// sends findings + probes to gemini for a "did this match?" verdict.
// Cost ~$0.01 per fixture per arm, but materially better signal.

const KEYWORD_MATCH_THRESHOLD = 2; // ≥2 keywords must appear in the finding text

export function score({ verdict, probes }) {
  const findings = Array.isArray(verdict?.findings) ? verdict.findings : [];
  const caught = [];
  const missed = [];

  for (const probe of probes.should_flag) {
    const match = findings.find((f) => probeMatchesFinding(probe, f));
    if (match) {
      caught.push({ probe, finding: match });
    } else {
      missed.push({ probe });
    }
  }

  // Negative probes — anything we incorrectly raised. Heuristic: any
  // finding that doesn't match a `should_flag` AND wasn't explicitly
  // listed as `should_not_flag` is borderline. We surface it as
  // "extra" for the human to review.
  const matchedFindingIds = new Set(caught.map((c) => findingId(c.finding)));
  const extra = findings.filter((f) => !matchedFindingIds.has(findingId(f)));

  return {
    caught,
    missed,
    extra,
    recall: probes.should_flag.length > 0 ? caught.length / probes.should_flag.length : 1,
    findings_total: findings.length,
  };
}

function probeMatchesFinding(probe, finding) {
  const haystack = [finding.title ?? "", finding.body ?? "", finding.recommendation ?? ""].join(" ").toLowerCase();
  let hits = 0;
  for (const kw of probe.keywords ?? []) {
    if (haystack.includes(kw.toLowerCase())) hits++;
    if (hits >= KEYWORD_MATCH_THRESHOLD) return true;
  }
  return hits >= KEYWORD_MATCH_THRESHOLD;
}

function findingId(finding) {
  return `${finding.file ?? ""}:${finding.line_start ?? 0}:${(finding.title ?? "").slice(0, 40)}`;
}
