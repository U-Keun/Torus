export interface SqlQuery {
  text: string;
  values: unknown[];
}

const SCORE_COLUMNS = new Set([
  "player_name", "score", "level", "created_at", "skill_usage", "client_uuid",
  "attempts_used", "active_attempt_token",
]);
const STREAK_COLUMNS = new Set([
  "client_uuid", "current_streak", "max_streak", "last_submission_key", "updated_at",
]);
const MAX_LIMIT = 2048;

function assertAllowedParams(params: URLSearchParams, allowed: Set<string>): void {
  for (const key of params.keys()) {
    if (!allowed.has(key)) throw new Error("INVALID_QUERY_PARAMETER");
  }
}

function selectedColumns(raw: string | null, allowed: Set<string>): string[] {
  if (!raw) throw new Error("INVALID_SELECT");
  const columns = raw.split(",").map((value) => value.trim());
  if (columns.length === 0 || columns.some((value) => !allowed.has(value))) {
    throw new Error("INVALID_SELECT");
  }
  return [...new Set(columns)];
}

function limitValue(raw: string | null): number {
  if (raw === null) return 100;
  if (!/^\d+$/.test(raw)) throw new Error("INVALID_LIMIT");
  return Math.max(0, Math.min(MAX_LIMIT, Number(raw)));
}

function eq(raw: string | null): string | null {
  if (raw === null) return null;
  if (!raw.startsWith("eq.")) throw new Error("INVALID_FILTER");
  return raw.slice(3);
}

export function buildScoresQuery(params: URLSearchParams): SqlQuery {
  assertAllowedParams(params, new Set(["select", "mode", "challenge_key", "daily_has_submission", "client_uuid", "order", "limit"]));
  const columns = selectedColumns(params.get("select"), SCORE_COLUMNS);
  const values: unknown[] = [];
  const where: string[] = [];
  const add = (column: string, value: unknown) => {
    values.push(value);
    where.push(`${column} = $${values.length}`);
  };

  const mode = eq(params.get("mode"));
  if (mode !== null) {
    if (mode !== "classic" && mode !== "daily") throw new Error("INVALID_MODE");
    add("mode", mode);
  }
  const challengeKey = eq(params.get("challenge_key"));
  if (challengeKey !== null) {
    if (challengeKey !== "classic" && !/^\d{4}-\d{2}-\d{2}$/.test(challengeKey)) {
      throw new Error("INVALID_CHALLENGE_KEY");
    }
    add("challenge_key", challengeKey);
  }
  const submitted = eq(params.get("daily_has_submission"));
  if (submitted !== null) {
    if (submitted !== "true" && submitted !== "false") throw new Error("INVALID_FILTER");
    add("daily_has_submission", submitted === "true");
  }
  const clientUuid = eq(params.get("client_uuid"));
  if (clientUuid !== null) {
    if (clientUuid.length < 8 || clientUuid.length > 80) throw new Error("INVALID_CLIENT_UUID");
    add("client_uuid", clientUuid);
  }
  if (
    columns.some((column) => column === "attempts_used" || column === "active_attempt_token") &&
    clientUuid === null
  ) {
    throw new Error("INVALID_FILTER");
  }

  const order = params.get("order");
  if (order !== null && order !== "score.desc,level.desc,created_at.desc") {
    throw new Error("INVALID_ORDER");
  }
  const selectExpressions = columns.map((column) =>
    column === "active_attempt_token"
      ? "CASE WHEN active_attempt_token_hash IS NULL THEN NULL ELSE 'present' END AS active_attempt_token"
      : column,
  );
  values.push(limitValue(params.get("limit")));
  return {
    // Preserve the legacy field shape without exposing the capability token.
    text: `SELECT ${selectExpressions.join(", ")} FROM public.scores${where.length ? ` WHERE ${where.join(" AND ")}` : ""}${order ? " ORDER BY score DESC, level DESC, created_at DESC" : ""} LIMIT $${values.length}`,
    values,
  };
}

function parseInFilter(raw: string): string[] {
  if (!raw.startsWith("in.(") || !raw.endsWith(")")) throw new Error("INVALID_FILTER");
  let decoded: unknown;
  try {
    decoded = JSON.parse(`[${raw.slice(4, -1)}]`);
  } catch {
    throw new Error("INVALID_FILTER");
  }
  if (
    !Array.isArray(decoded) || decoded.length === 0 || decoded.length > MAX_LIMIT ||
    decoded.some((value) => typeof value !== "string" || value.length < 8 || value.length > 80)
  ) {
    throw new Error("INVALID_CLIENT_UUID");
  }
  return decoded as string[];
}

export function buildStreakQuery(params: URLSearchParams): SqlQuery {
  assertAllowedParams(params, new Set(["select", "client_uuid", "limit"]));
  const columns = selectedColumns(params.get("select"), STREAK_COLUMNS);
  const values: unknown[] = [];
  let where = "";
  const filter = params.get("client_uuid");
  if (filter !== null) {
    if (filter.startsWith("eq.")) {
      const value = eq(filter)!;
      if (value.length < 8 || value.length > 80) throw new Error("INVALID_CLIENT_UUID");
      values.push(value);
      where = ` WHERE client_uuid = $${values.length}`;
    } else {
      const owners = parseInFilter(filter);
      values.push(owners);
      where = ` WHERE client_uuid = ANY($${values.length}::text[])`;
    }
  }
  values.push(limitValue(params.get("limit")));
  return {
    text: `SELECT ${columns.join(", ")} FROM public.daily_streak_states${where} LIMIT $${values.length}`,
    values,
  };
}
