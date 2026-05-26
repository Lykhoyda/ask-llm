// Markdown report generator. Renders per-fixture comparison + aggregate
// recall delta. Output is meant to be human-readable AND grep-able for
// a CI gate (e.g. fail the benchmark run if recall regresses by > 10%).

export function renderReport({ fixtures, runs, meta }) {
  const lines = [];
  lines.push(`# ADR-100 prompt A/B benchmark report`);
  lines.push("");
  lines.push(`- Generated: ${meta.timestamp}`);
  lines.push(`- Model: \`${meta.model}\``);
  lines.push(`- Arms: ${meta.arms.join(" vs ")}`);
  lines.push(`- Fixtures: ${fixtures.length}`);
  lines.push("");

  // Aggregate recall delta
  const aggregate = {};
  for (const arm of meta.arms) {
    const r = runs[arm];
    const totalShouldFlag = fixtures.reduce(
      (a, f) => a + (r[f.name]?.score?.caught.length ?? 0) + (r[f.name]?.score?.missed.length ?? 0),
      0,
    );
    const totalCaught = fixtures.reduce(
      (a, f) => a + (r[f.name]?.score?.caught.length ?? 0),
      0,
    );
    const totalExtra = fixtures.reduce(
      (a, f) => a + (r[f.name]?.score?.extra.length ?? 0),
      0,
    );
    aggregate[arm] = {
      recall: totalShouldFlag > 0 ? totalCaught / totalShouldFlag : 1,
      caught: totalCaught,
      missed: totalShouldFlag - totalCaught,
      extra: totalExtra,
    };
  }

  lines.push(`## Aggregate`);
  lines.push("");
  lines.push("| Arm | Recall | Caught | Missed | Extra findings (potential noise) |");
  lines.push("|---|---|---|---|---|");
  for (const arm of meta.arms) {
    const a = aggregate[arm];
    lines.push(
      `| \`${arm}\` | ${(a.recall * 100).toFixed(1)}% | ${a.caught} | ${a.missed} | ${a.extra} |`,
    );
  }
  lines.push("");

  // If every fixture errored on at least one arm, there's no signal to compute
  // a recall delta on. Surface the situation and skip the decision-rule line.
  const anyArmAllErrored = meta.arms.some((arm) =>
    fixtures.every((f) => runs[arm][f.name]?.error),
  );
  if (anyArmAllErrored) {
    lines.push("> **No comparable data — at least one arm errored on every fixture.** See per-fixture sections below for individual error messages.");
    lines.push("");
  } else if (meta.arms.length === 2) {
    const [armA, armB] = meta.arms;
    const recallDelta = aggregate[armB].recall - aggregate[armA].recall;
    const extraDelta = aggregate[armB].extra - aggregate[armA].extra;
    lines.push(`**Recall delta (\`${armB}\` − \`${armA}\`):** ${(recallDelta * 100).toFixed(1)} pp`);
    lines.push(`**Extra-finding delta:** ${extraDelta >= 0 ? "+" : ""}${extraDelta} findings`);
    lines.push("");
    lines.push(
      `> Decision rule: ship the change if recall delta ≥ +10 pp AND extra-finding delta ≤ +1 per fixture on average. If recall regresses or noise jumps, reverse ADR-099 per its documented two-file rollback path.`,
    );
    lines.push("");
  }

  // Per-fixture detail
  for (const fixture of fixtures) {
    lines.push(`## Fixture \`${fixture.name}\` — ${fixture.probes.category}`);
    lines.push("");
    lines.push(`**Task:** ${fixture.probes.task_description}`);
    lines.push("");
    for (const arm of meta.arms) {
      const run = runs[arm][fixture.name];
      if (!run) {
        lines.push(`### Arm \`${arm}\`: (no run data)`);
        lines.push("");
        continue;
      }
      if (run.error) {
        lines.push(`### Arm \`${arm}\`: FAILED — ${run.error}`);
        lines.push(`*Duration: ${(run.durationMs / 1000).toFixed(1)}s*`);
        lines.push("");
        continue;
      }
      const s = run.score;
      lines.push(`### Arm \`${arm}\` — recall ${(s.recall * 100).toFixed(0)}%, ${run.usage?.input_tokens ?? "?"} in / ${run.usage?.output_tokens ?? "?"} out`);
      lines.push("");
      if (s.caught.length > 0) {
        lines.push("**Caught (true positives):**");
        for (const c of s.caught) {
          lines.push(`- ✅ \`${c.probe.id}\` (${c.probe.severity_expected}) — ${c.probe.description}`);
          lines.push(`  └─ Finding: ${c.finding.severity?.toUpperCase()} "${c.finding.title}" at ${c.finding.file}:${c.finding.line_start}`);
        }
        lines.push("");
      }
      if (s.missed.length > 0) {
        lines.push("**Missed (false negatives):**");
        for (const m of s.missed) {
          lines.push(`- ❌ \`${m.probe.id}\` (${m.probe.severity_expected}) — ${m.probe.description}`);
        }
        lines.push("");
      }
      if (s.extra.length > 0) {
        lines.push(`**Extra findings (manual judgment — noise or unexpected real?):**`);
        for (const e of s.extra) {
          lines.push(`- ⚠️  ${e.severity?.toUpperCase()} "${e.title}" at ${e.file}:${e.line_start}`);
          if (e.body) lines.push(`  └─ ${e.body.slice(0, 200)}${e.body.length > 200 ? "…" : ""}`);
        }
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}
