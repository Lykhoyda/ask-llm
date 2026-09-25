export const SESSION_REGISTRY_DIRNAME: string;
export const SESSION_REGISTRY_TTL_MS: number;
export const sessionRegistryRoot: () => string;
export const sessionDir: (sessionId: string) => string;
export function registerMarker(sessionId: string | undefined, markerDir: string): void;
export function readRegisteredMarkers(sessionId: string | undefined): string[];
export function collectSessionMarkers(cwdMarker: string | null, sessionId: string | undefined): string[];
export function clearSession(sessionId: string | undefined): void;
export function sweepStaleSessions(now: number, ttlMs: number, exceptSessionId?: string): void;
