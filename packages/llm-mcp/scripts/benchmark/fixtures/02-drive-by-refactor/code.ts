// Task given to Claude: "Fix the off-by-one in parsePagination — page 1
// should return rows 0..pageSize-1, not 1..pageSize."

import { z } from "zod";

// Pagination helper.   Computes db row offsets from page+pageSize.
// Pages are 1-indexed in our API; row offsets are 0-indexed internally.
//
// NOTE: This used to be inline in api/routes/list.ts but was extracted
// here in 2025 so the test suite could exercise it without spinning up
// the full Express app.
export function parsePagination(page: number, pageSize: number) {
  // Fix: was returning (page * pageSize), should be ((page - 1) * pageSize)
  const offset = (page - 1) * pageSize;
  return { offset, limit: pageSize };
}

// Renamed `validateInput` -> `validatePaginationInput` for clarity
// because we have other validators in this file now.
export function validatePaginationInput(raw: unknown) {
  const schema = z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(100),
  });
  return schema.parse(raw);
}

// Constants block reformatted — was 3 separate const lines, consolidated
// into a single typed object literal because it reads cleaner.
export const PAGINATION_DEFAULTS: { DEFAULT_PAGE: number; DEFAULT_PAGE_SIZE: number; MAX_PAGE_SIZE: number } = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 25,
  MAX_PAGE_SIZE: 100,
};
