const evidence = `begin-${"x".repeat(2 * 1024 * 1024)}-end`;

const payload = {
  summary: "Large valid fixture result.",
  findings: [
    {
      id: "R-LARGE",
      severity: "high",
      confidence: 99,
      title: "Backpressured stdout",
      evidence,
      recommendation: "Wait for the complete stdout write.",
      file: "src/redacted.ts",
      line: 42,
    },
  ],
};

export async function executeCodexCLI() {
  return {
    response: JSON.stringify(payload),
    model: "gpt-fixture",
    threadId: "thread-fixture-large",
  };
}
