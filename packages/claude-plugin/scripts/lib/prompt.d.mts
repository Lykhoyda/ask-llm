export function loadPromptTemplate(): string;
export function buildReviewPrompt(options: {
  filePath: string;
  fileContent: string;
  toolName: string;
  projectContext: string;
  partialView: boolean;
}): string;
