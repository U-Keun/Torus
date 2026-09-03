use crate::auth::{AuthenticatedEndpoint, ClientState, PublicEndpoint};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

const CACHE_FILE_NAME: &str = "scoreboard-global-cache-v1.json";
const DEVICE_UUID_FILE_NAME: &str = "device-uuid-v1.txt";
const CACHE_MAX_ENTRIES: usize = 100;
const DEFAULT_TOP_LIMIT: usize = 10;
const MAX_TOP_LIMIT: usize = 100;
const MAX_SKILL_USAGE_ITEMS: usize = 20;
const MAX_SKILL_NAME_LEN: usize = 20;
const MAX_SKILL_HOTKEY_LEN: usize = 16;
const MAX_SKILL_COMMAND_LEN: usize = 120;
const CLASSIC_MODE: &str = "classic";
const DAILY_MODE: &str = "daily";
const CLASSIC_CHALLENGE_KEY: &str = "classic";
const DAILY_MAX_ATTEMPTS: i64 = 3;
const DAILY_BADGE_MAX_POWER: i64 = 9;
const MAX_DAILY_REPLAY_EVENTS: usize = 20_000;
const MAX_DAILY_REPLAY_FINAL_TIME: i64 = 2_000_000;
const MAX_DAILY_ATTEMPT_TOKEN_LEN: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillUsage {
    pub name: String,
    pub hotkey: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoreEntry {
    pub user: String,
    pub score: i64,
    pub level: i64,
    pub date: String,
    #[serde(
        rename = "badgePower",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub badge_power: Option<i64>,
    #[serde(
        rename = "badgeMaxStreak",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub badge_max_streak: Option<i64>,
    #[serde(rename = "skillUsage", default)]
    pub skill_usage: Vec<SkillUsage>,
    #[serde(rename = "isMe", default)]
    pub is_me: bool,
}

#[derive(Debug, Deserialize)]
struct ScoreRow {
    player_name: String,
    score: i64,
    level: i64,
    created_at: String,
    #[serde(default)]
    skill_usage: Option<Vec<SkillUsage>>,
    #[serde(default)]
    client_uuid: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DailyAttemptsRow {
    #[serde(default)]
    attempts_used: Option<i64>,
    #[serde(default)]
    active_attempt_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DailyStreakStateRow {
    #[serde(default)]
    current_streak: Option<i64>,
    #[serde(default)]
    max_streak: Option<i64>,
    #[serde(default)]
    last_submission_key: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DailyStreakLookupRow {
    client_uuid: String,
    #[serde(default)]
    max_streak: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct DailyStatus {
    #[serde(rename = "challengeKey")]
    challenge_key: String,
    #[serde(rename = "attemptsUsed")]
    attempts_used: i64,
    #[serde(rename = "attemptsLeft")]
    attempts_left: i64,
    #[serde(rename = "maxAttempts")]
    max_attempts: i64,
    #[serde(rename = "canSubmit")]
    can_submit: bool,
    #[serde(rename = "hasActiveAttempt")]
    has_active_attempt: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyBadgeStatus {
    #[serde(rename = "currentStreak")]
    pub current_streak: i64,
    #[serde(rename = "maxStreak")]
    pub max_streak: i64,
    #[serde(rename = "highestBadgePower")]
    pub highest_badge_power: Option<i64>,
    #[serde(rename = "highestBadgeDays")]
    pub highest_badge_days: Option<i64>,
    #[serde(rename = "nextBadgePower")]
    pub next_badge_power: Option<i64>,
    #[serde(rename = "nextBadgeDays")]
    pub next_badge_days: Option<i64>,
    #[serde(rename = "daysToNextBadge")]
    pub days_to_next_badge: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DailyAttemptStartResult {
    pub accepted: bool,
    #[serde(default)]
    pub resumed: bool,
    #[serde(rename = "attemptToken", default)]
    pub attempt_token: Option<String>,
    #[serde(rename = "challengeKey")]
    pub challenge_key: String,
    #[serde(rename = "attemptsUsed")]
    pub attempts_used: i64,
    #[serde(rename = "attemptsLeft")]
    pub attempts_left: i64,
    #[serde(rename = "maxAttempts")]
    pub max_attempts: i64,
    #[serde(rename = "canSubmit")]
    pub can_submit: bool,
    #[serde(rename = "hasActiveAttempt", default)]
    pub has_active_attempt: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DailySubmitResult {
    pub accepted: bool,
    #[serde(default)]
    pub improved: bool,
    #[serde(rename = "challengeKey")]
    pub challenge_key: String,
    #[serde(rename = "attemptsUsed")]
    pub attempts_used: i64,
    #[serde(rename = "attemptsLeft")]
    pub attempts_left: i64,
    #[serde(rename = "maxAttempts")]
    pub max_attempts: i64,
    #[serde(rename = "canSubmit")]
    pub can_submit: bool,
    #[serde(rename = "hasActiveAttempt", default)]
    pub has_active_attempt: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DailyForfeitResult {
    pub accepted: bool,
    #[serde(rename = "challengeKey")]
    pub challenge_key: String,
    #[serde(rename = "attemptsUsed")]
    pub attempts_used: i64,
    #[serde(rename = "attemptsLeft")]
    pub attempts_left: i64,
    #[serde(rename = "maxAttempts")]
    pub max_attempts: i64,
    #[serde(rename = "canSubmit")]
    pub can_submit: bool,
    #[serde(rename = "hasActiveAttempt", default)]
    pub has_active_attempt: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayInputEvent {
    pub time: i64,
    #[serde(rename = "move")]
    pub move_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyReplayProof {
    pub version: i64,
    pub difficulty: i64,
    pub seed: u32,
    #[serde(rename = "finalTime")]
    pub final_time: i64,
    #[serde(rename = "finalScore")]
    pub final_score: i64,
    #[serde(rename = "finalLevel")]
    pub final_level: i64,
    pub inputs: Vec<ReplayInputEvent>,
}

#[derive(Debug, Serialize)]
struct DailyStartPayload<'a> {
    p_client_uuid: &'a str,
    p_challenge_key: &'a str,
    p_player_name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    p_attempt_token: Option<&'a str>,
}

#[derive(Debug, Serialize)]
struct DailyForfeitPayload<'a> {
    p_client_uuid: &'a str,
    p_challenge_key: &'a str,
    p_attempt_token: &'a str,
}

#[derive(Debug, Serialize)]
struct VerifyScorePayload<'a> {
    mode: &'a str,
    #[serde(rename = "challengeKey")]
    challenge_key: &'a str,
    #[serde(rename = "attemptToken", skip_serializing_if = "Option::is_none")]
    attempt_token: Option<&'a str>,
    #[serde(rename = "clientUuid")]
    client_uuid: &'a str,
    entry: &'a ScoreEntry,
    #[serde(rename = "replayProof")]
    replay_proof: &'a DailyReplayProof,
}

#[tauri::command]
pub async fn fetch_global_scores(
    app: AppHandle,
    state: State<'_, ClientState>,
    limit: Option<u32>,
) -> Result<Vec<ScoreEntry>, String> {
    let top_limit = normalize_limit(limit);
    let mut cache = read_cache(&app)?;
    let mut owner_keys = Vec::new();
    if let Ok(value) = get_or_create_device_uuid(&app, &state) {
        owner_keys.push(value);
    }
    if let Ok(value) = state.owner_id().await {
        owner_keys.push(value);
    }
    match fetch_remote_scores(&state, top_limit, &owner_keys).await {
        Ok(remote_entries) => {
            cache.extend(remote_entries.clone());
            sort_and_dedupe(&mut cache);
            truncate_cache(&mut cache);
            write_cache(&app, &cache)?;
            return Ok(remote_entries);
        }
        Err(error) => {
            eprintln!("Failed to load scores from the backend API. Using local cache. {error}");
        }
    }

    sort_and_dedupe(&mut cache);
    Ok(cache.into_iter().take(top_limit).collect())
}

#[tauri::command]
pub async fn submit_global_score(
    app: AppHandle,
    state: State<'_, ClientState>,
    entry: ScoreEntry,
    replay_proof: DailyReplayProof,
) -> Result<(), String> {
    let mut cache = read_cache(&app)?;
    let mut entry = sanitize_entry(entry)?;
    let replay_proof = sanitize_daily_replay_proof(replay_proof)?;
    entry.is_me = true;
    cache.push(entry.clone());
    sort_and_dedupe(&mut cache);
    truncate_cache(&mut cache);
    write_cache(&app, &cache)?;

    let remote_result = match state.owner_id().await {
        Ok(owner_id) => submit_remote_global_score(&state, &entry, &replay_proof, &owner_id).await,
        Err(error) => Err(error),
    };
    if let Err(error) = remote_result {
        eprintln!("Failed to save score to the backend API. Score kept locally. {error}");
    }

    Ok(())
}

#[tauri::command]
pub async fn fetch_daily_scores(
    app: AppHandle,
    state: State<'_, ClientState>,
    challenge_key: String,
    limit: Option<u32>,
) -> Result<Vec<ScoreEntry>, String> {
    let top_limit = normalize_limit(limit);
    let normalized_challenge_key = normalize_daily_challenge_key(&challenge_key)?;
    let mut owner_keys = Vec::new();
    if let Ok(value) = get_or_create_device_uuid(&app, &state) {
        owner_keys.push(value);
    }
    if let Ok(value) = state.owner_id().await {
        owner_keys.push(value);
    }
    fetch_remote_daily_scores(&state, &normalized_challenge_key, top_limit, &owner_keys).await
}

#[tauri::command]
pub async fn fetch_daily_status(
    _app: AppHandle,
    state: State<'_, ClientState>,
    challenge_key: String,
) -> Result<DailyStatus, String> {
    let normalized_challenge_key = normalize_daily_challenge_key(&challenge_key)?;
    let owner_id = state.owner_id().await?;
    let remote_status =
        fetch_remote_daily_attempts(&state, &normalized_challenge_key, &owner_id).await?;
    Ok(build_daily_status(
        &normalized_challenge_key,
        remote_status.attempts_used,
        remote_status.has_active_attempt,
    ))
}

#[tauri::command]
pub async fn fetch_daily_badge_status(
    _app: AppHandle,
    state: State<'_, ClientState>,
    challenge_key: String,
) -> Result<DailyBadgeStatus, String> {
    let normalized_challenge_key = normalize_daily_challenge_key(&challenge_key)?;
    let owner_id = state.owner_id().await?;
    let state = fetch_remote_daily_streak_state(&state, &owner_id).await?;
    let (current_streak, max_streak) = match state {
        Some(value) => {
            let stored_current = value.current_streak.unwrap_or(0).max(0);
            let stored_max = value.max_streak.unwrap_or(0).max(stored_current).max(0);
            let effective_current = if is_current_streak_alive(
                value.last_submission_key.as_deref(),
                &normalized_challenge_key,
            ) {
                stored_current
            } else {
                0
            };
            (effective_current, stored_max)
        }
        None => (0, 0),
    };
    Ok(badge_status_from_streaks(current_streak, max_streak))
}

#[tauri::command]
pub async fn start_daily_attempt(
    _app: AppHandle,
    state: State<'_, ClientState>,
    challenge_key: String,
    attempt_token: Option<String>,
) -> Result<DailyAttemptStartResult, String> {
    let normalized_challenge_key = normalize_daily_challenge_key(&challenge_key)?;
    let normalized_attempt_token = normalize_daily_attempt_token_candidate(attempt_token)?;
    let owner_id = state.owner_id().await?;
    start_remote_daily_attempt(
        &state,
        &normalized_challenge_key,
        normalized_attempt_token.as_deref(),
        &owner_id,
    )
    .await
}

#[tauri::command]
pub async fn submit_daily_score(
    _app: AppHandle,
    state: State<'_, ClientState>,
    challenge_key: String,
    attempt_token: String,
    entry: ScoreEntry,
    replay_proof: DailyReplayProof,
) -> Result<DailySubmitResult, String> {
    let normalized_challenge_key = normalize_daily_challenge_key(&challenge_key)?;
    let entry = sanitize_entry(entry)?;
    let replay_proof = sanitize_daily_replay_proof(replay_proof)?;
    let owner_id = state.owner_id().await?;
    let normalized_attempt_token = attempt_token.trim().to_string();
    if normalized_attempt_token.is_empty() {
        return Err("daily challenge attempt token is required".into());
    }
    submit_remote_daily_score(
        &state,
        &normalized_challenge_key,
        &normalized_attempt_token,
        &entry,
        &replay_proof,
        &owner_id,
    )
    .await
}

#[tauri::command]
pub async fn forfeit_daily_attempt(
    _app: AppHandle,
    state: State<'_, ClientState>,
    challenge_key: String,
    attempt_token: String,
) -> Result<DailyForfeitResult, String> {
    let normalized_challenge_key = normalize_daily_challenge_key(&challenge_key)?;
    let normalized_attempt_token = attempt_token.trim().to_string();
    if normalized_attempt_token.is_empty() {
        return Err("daily challenge attempt token is required".into());
    }
    let owner_id = state.owner_id().await?;
    forfeit_remote_daily_attempt(
        &state,
        &normalized_challenge_key,
        &normalized_attempt_token,
        &owner_id,
    )
    .await
}

#[tauri::command]
pub async fn rollback_daily_attempt(
    _app: AppHandle,
    state: State<'_, ClientState>,
    challenge_key: String,
    attempt_token: String,
) -> Result<DailyForfeitResult, String> {
    let normalized_challenge_key = normalize_daily_challenge_key(&challenge_key)?;
    let normalized_attempt_token = attempt_token.trim().to_string();
    if normalized_attempt_token.is_empty() {
        return Err("daily challenge attempt token is required".into());
    }
    let owner_id = state.owner_id().await?;
    rollback_remote_daily_attempt(
        &state,
        &normalized_challenge_key,
        &normalized_attempt_token,
        &owner_id,
    )
    .await
}

fn normalize_limit(limit: Option<u32>) -> usize {
    let raw = limit.unwrap_or(DEFAULT_TOP_LIMIT as u32);
    raw.clamp(1, MAX_TOP_LIMIT as u32) as usize
}

fn normalize_daily_attempt_token_candidate(raw: Option<String>) -> Result<Option<String>, String> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > MAX_DAILY_ATTEMPT_TOKEN_LEN {
        return Err("daily challenge attempt token exceeds limit".into());
    }
    Ok(Some(trimmed.to_string()))
}

fn normalize_daily_challenge_key(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.len() != 10 {
        return Err("daily challenge key must be in YYYY-MM-DD format".into());
    }
    let bytes = trimmed.as_bytes();
    for (index, ch) in bytes.iter().enumerate() {
        let is_dash = index == 4 || index == 7;
        if is_dash {
            if *ch != b'-' {
                return Err("daily challenge key must be in YYYY-MM-DD format".into());
            }
            continue;
        }
        if !(*ch >= b'0' && *ch <= b'9') {
            return Err("daily challenge key must be in YYYY-MM-DD format".into());
        }
    }
    Ok(trimmed.to_string())
}

struct RemoteDailyAttemptStatus {
    attempts_used: i64,
    has_active_attempt: bool,
}

fn build_daily_status(
    challenge_key: &str,
    attempts_used: i64,
    has_active_attempt: bool,
) -> DailyStatus {
    let used = attempts_used.clamp(0, DAILY_MAX_ATTEMPTS);
    let left = DAILY_MAX_ATTEMPTS - used;
    DailyStatus {
        challenge_key: challenge_key.to_string(),
        attempts_used: used,
        attempts_left: left,
        max_attempts: DAILY_MAX_ATTEMPTS,
        can_submit: left > 0,
        has_active_attempt,
    }
}

fn sanitize_entry(entry: ScoreEntry) -> Result<ScoreEntry, String> {
    let user = entry.user.trim().chars().take(20).collect::<String>();
    if user.is_empty() {
        return Err("score entry user is empty".into());
    }

    let mut seen = HashSet::<String>::new();
    let mut skill_usage: Vec<SkillUsage> = Vec::new();
    for usage in entry.skill_usage.into_iter().take(MAX_SKILL_USAGE_ITEMS) {
        let name = usage
            .name
            .trim()
            .chars()
            .take(MAX_SKILL_NAME_LEN)
            .collect::<String>();
        if name.is_empty() {
            continue;
        }

        let hotkey = usage
            .hotkey
            .map(|value| {
                value
                    .trim()
                    .chars()
                    .take(MAX_SKILL_HOTKEY_LEN)
                    .collect::<String>()
            })
            .filter(|value| !value.is_empty());

        let command = usage
            .command
            .map(|value| {
                value
                    .trim()
                    .chars()
                    .take(MAX_SKILL_COMMAND_LEN)
                    .collect::<String>()
            })
            .filter(|value| !value.is_empty());

        let key = format!(
            "{}::{}::{}",
            name,
            hotkey.clone().unwrap_or_default(),
            command.clone().unwrap_or_default()
        );
        if !seen.insert(key) {
            continue;
        }

        skill_usage.push(SkillUsage {
            name,
            hotkey,
            command,
        });
    }

    Ok(ScoreEntry {
        user,
        score: entry.score.max(0),
        level: entry.level.max(0),
        date: entry.date.trim().to_string(),
        badge_power: None,
        badge_max_streak: None,
        skill_usage,
        is_me: false,
    })
}

fn sanitize_daily_replay_proof(proof: DailyReplayProof) -> Result<DailyReplayProof, String> {
    if proof.version != 1 {
        return Err("daily replay proof version is not supported".into());
    }
    if proof.difficulty != 1 && proof.difficulty != 2 && proof.difficulty != 3 {
        return Err("daily replay proof difficulty is invalid".into());
    }
    if proof.final_time < 0 || proof.final_score < 0 || proof.final_level < 0 {
        return Err("daily replay proof has invalid final values".into());
    }
    if proof.final_time > MAX_DAILY_REPLAY_FINAL_TIME {
        return Err("daily replay proof final time exceeds limit".into());
    }

    let mut sanitized_inputs: Vec<ReplayInputEvent> = Vec::new();
    let mut last_time = -1_i64;
    for event in proof.inputs.into_iter().take(MAX_DAILY_REPLAY_EVENTS) {
        if event.time < 0 {
            return Err("daily replay input time cannot be negative".into());
        }
        if event.time < last_time {
            return Err("daily replay input time order is invalid".into());
        }
        let normalized_move = event.move_dir.trim().to_ascii_lowercase();
        match normalized_move.as_str() {
            "left" | "right" | "up" | "down" => {
                sanitized_inputs.push(ReplayInputEvent {
                    time: event.time,
                    move_dir: normalized_move,
                });
                last_time = event.time;
            }
            _ => {
                return Err("daily replay input move is invalid".into());
            }
        }
    }

    if sanitized_inputs
        .last()
        .map(|event| event.time > proof.final_time)
        .unwrap_or(false)
    {
        return Err("daily replay input exceeds final time".into());
    }

    Ok(DailyReplayProof {
        version: 1,
        difficulty: proof.difficulty,
        seed: proof.seed,
        final_time: proof.final_time,
        final_score: proof.final_score,
        final_level: proof.final_level,
        inputs: sanitized_inputs,
    })
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?;

    fs::create_dir_all(&dir).map_err(|error| format!("failed to create app data dir: {error}"))?;
    Ok(dir)
}

fn score_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app_data_dir(app)?;
    dir.push(CACHE_FILE_NAME);
    Ok(dir)
}

fn device_uuid_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app_data_dir(app)?;
    dir.push(DEVICE_UUID_FILE_NAME);
    Ok(dir)
}

fn read_device_uuid(path: &Path) -> Option<String> {
    if !path.exists() {
        return None;
    }

    let raw = fs::read_to_string(path).ok()?;
    let normalized = Uuid::parse_str(raw.trim()).ok()?;
    Some(normalized.to_string())
}

fn get_or_create_device_uuid(app: &AppHandle, state: &ClientState) -> Result<String, String> {
    let _guard = state
        .device_uuid_lock
        .lock()
        .map_err(|_| "device UUID lock failed".to_string())?;
    let path = device_uuid_path(app)?;
    if let Some(existing) = read_device_uuid(&path) {
        return Ok(existing);
    }

    let created = Uuid::new_v4().to_string();
    fs::write(&path, &created).map_err(|error| format!("failed to write device uuid: {error}"))?;
    Ok(created)
}

fn read_cache(app: &AppHandle) -> Result<Vec<ScoreEntry>, String> {
    let path = score_cache_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw =
        fs::read_to_string(&path).map_err(|error| format!("failed to read cache: {error}"))?;
    let mut entries: Vec<ScoreEntry> = serde_json::from_str(&raw).unwrap_or_default();
    sort_and_dedupe(&mut entries);
    truncate_cache(&mut entries);
    Ok(entries)
}

fn write_cache(app: &AppHandle, entries: &[ScoreEntry]) -> Result<(), String> {
    let path = score_cache_path(app)?;
    let body = serde_json::to_string(entries)
        .map_err(|error| format!("failed to serialize cache: {error}"))?;
    fs::write(path, body).map_err(|error| format!("failed to write cache: {error}"))?;
    Ok(())
}

fn sort_and_dedupe(entries: &mut Vec<ScoreEntry>) {
    entries.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| b.level.cmp(&a.level))
            .then_with(|| b.date.cmp(&a.date))
    });

    let mut deduped: HashMap<String, ScoreEntry> = HashMap::new();
    for entry in entries.drain(..) {
        let skill_usage_key = serde_json::to_string(&entry.skill_usage).unwrap_or_default();
        let key = format!(
            "{}::{}::{}::{}::{}",
            entry.user, entry.score, entry.level, entry.date, skill_usage_key
        );
        if let Some(existing) = deduped.get_mut(&key) {
            existing.is_me = existing.is_me || entry.is_me;
            continue;
        }
        deduped.insert(key, entry);
    }

    let mut values = deduped.into_values().collect::<Vec<_>>();
    values.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| b.level.cmp(&a.level))
            .then_with(|| b.date.cmp(&a.date))
    });
    *entries = values;
}

fn truncate_cache(entries: &mut Vec<ScoreEntry>) {
    if entries.len() > CACHE_MAX_ENTRIES {
        entries.truncate(CACHE_MAX_ENTRIES);
    }
}

async fn fetch_remote_scores(
    state: &ClientState,
    limit: usize,
    owner_keys: &[String],
) -> Result<Vec<ScoreEntry>, String> {
    let request = state.public_request(PublicEndpoint::Scores).query(&[
        (
            "select",
            "player_name,score,level,created_at,skill_usage,client_uuid",
        ),
        ("mode", "eq.classic"),
        ("challenge_key", "eq.classic"),
        ("order", "score.desc,level.desc,created_at.desc"),
        ("limit", &limit.to_string()),
    ]);

    let response = request
        .send()
        .await
        .map_err(|error| format!("backend API request failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("backend API request failed with {status}: {body}"));
    }

    let rows = response
        .json::<Vec<ScoreRow>>()
        .await
        .map_err(|error| format!("failed to decode backend API response: {error}"))?;

    let owners = rows
        .iter()
        .filter_map(|row| row.client_uuid.clone())
        .collect::<Vec<_>>();
    let streak_map = match fetch_remote_streak_max_map(state, &owners).await {
        Ok(map) => map,
        Err(error) => {
            eprintln!("Failed to load streak states for scoreboard rows. {error}");
            HashMap::new()
        }
    };

    Ok(rows
        .into_iter()
        .map(|row| ScoreEntry {
            badge_max_streak: row
                .client_uuid
                .as_ref()
                .and_then(|value| streak_map.get(value).copied()),
            badge_power: row
                .client_uuid
                .as_ref()
                .and_then(|value| streak_map.get(value).copied())
                .and_then(resolve_badge_power),
            user: row.player_name,
            score: row.score,
            level: row.level,
            date: row.created_at,
            skill_usage: row.skill_usage.unwrap_or_default(),
            is_me: is_owned_by_owner(row.client_uuid.as_deref(), owner_keys),
        })
        .collect())
}

async fn fetch_remote_daily_scores(
    state: &ClientState,
    challenge_key: &str,
    limit: usize,
    owner_keys: &[String],
) -> Result<Vec<ScoreEntry>, String> {
    let mode_filter = format!("eq.{DAILY_MODE}");
    let challenge_filter = format!("eq.{challenge_key}");
    let response = state
        .public_request(PublicEndpoint::Scores)
        .query(&[
            (
                "select",
                "player_name,score,level,created_at,skill_usage,client_uuid",
            ),
            ("mode", mode_filter.as_str()),
            ("challenge_key", challenge_filter.as_str()),
            ("daily_has_submission", "eq.true"),
            ("order", "score.desc,level.desc,created_at.desc"),
            ("limit", &limit.to_string()),
        ])
        .send()
        .await
        .map_err(|error| format!("backend API daily fetch failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "backend API daily fetch failed with {status}: {body}"
        ));
    }

    let rows = response
        .json::<Vec<ScoreRow>>()
        .await
        .map_err(|error| format!("failed to decode backend API response: {error}"))?;

    let owners = rows
        .iter()
        .filter_map(|row| row.client_uuid.clone())
        .collect::<Vec<_>>();
    let streak_map = match fetch_remote_streak_max_map(state, &owners).await {
        Ok(map) => map,
        Err(error) => {
            eprintln!("Failed to load streak states for daily rows. {error}");
            HashMap::new()
        }
    };

    Ok(rows
        .into_iter()
        .map(|row| ScoreEntry {
            badge_max_streak: row
                .client_uuid
                .as_ref()
                .and_then(|value| streak_map.get(value).copied()),
            badge_power: row
                .client_uuid
                .as_ref()
                .and_then(|value| streak_map.get(value).copied())
                .and_then(resolve_badge_power),
            user: row.player_name,
            score: row.score,
            level: row.level,
            date: row.created_at,
            skill_usage: row.skill_usage.unwrap_or_default(),
            is_me: is_owned_by_owner(row.client_uuid.as_deref(), owner_keys),
        })
        .collect())
}

fn is_owned_by_owner(row_client_uuid: Option<&str>, owner_keys: &[String]) -> bool {
    row_client_uuid
        .map(|row_uuid| owner_keys.iter().any(|owner| owner == row_uuid))
        .unwrap_or(false)
}

async fn fetch_remote_streak_max_map(
    state: &ClientState,
    owner_keys: &[String],
) -> Result<HashMap<String, i64>, String> {
    let mut normalized = owner_keys
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    if normalized.is_empty() {
        return Ok(HashMap::new());
    }

    let owner_filter = format!(
        "in.({})",
        normalized
            .iter()
            .map(|value| quote_postgrest_text(value))
            .collect::<Vec<_>>()
            .join(",")
    );
    let response = state
        .public_request(PublicEndpoint::DailyStreakStates)
        .query(&[
            ("select", "client_uuid,max_streak"),
            ("client_uuid", owner_filter.as_str()),
            ("limit", "2048"),
        ])
        .send()
        .await
        .map_err(|error| format!("backend API streak state fetch failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "backend API streak state fetch failed with {status}: {body}"
        ));
    }

    let rows = response
        .json::<Vec<DailyStreakLookupRow>>()
        .await
        .map_err(|error| format!("failed to decode streak state response: {error}"))?;
    let mut map = HashMap::new();
    for row in rows {
        let max_streak = row.max_streak.unwrap_or(0).max(0);
        if max_streak > 0 {
            map.insert(row.client_uuid, max_streak);
        }
    }
    Ok(map)
}

fn quote_postgrest_text(raw: &str) -> String {
    let escaped = raw.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

async fn fetch_remote_daily_attempts(
    state: &ClientState,
    challenge_key: &str,
    owner_key: &str,
) -> Result<RemoteDailyAttemptStatus, String> {
    let mode_filter = format!("eq.{DAILY_MODE}");
    let challenge_filter = format!("eq.{challenge_key}");
    let uuid_filter = format!("eq.{owner_key}");
    let response = state
        .request(AuthenticatedEndpoint::Scores)
        .await?
        .query(&[
            ("select", "attempts_used,active_attempt_token"),
            ("mode", mode_filter.as_str()),
            ("challenge_key", challenge_filter.as_str()),
            ("client_uuid", uuid_filter.as_str()),
            ("limit", "1"),
        ])
        .send()
        .await
        .map_err(|error| format!("backend API daily status fetch failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "backend API daily status fetch failed with {}",
            response.status()
        ));
    }

    let rows = response
        .json::<Vec<DailyAttemptsRow>>()
        .await
        .map_err(|error| format!("failed to decode backend API response: {error}"))?;
    let attempts = rows.into_iter().next().unwrap_or(DailyAttemptsRow {
        attempts_used: Some(0),
        active_attempt_token: None,
    });
    Ok(RemoteDailyAttemptStatus {
        attempts_used: attempts
            .attempts_used
            .unwrap_or(0)
            .clamp(0, DAILY_MAX_ATTEMPTS),
        has_active_attempt: attempts
            .active_attempt_token
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false),
    })
}

async fn fetch_remote_daily_streak_state(
    state: &ClientState,
    owner_key: &str,
) -> Result<Option<DailyStreakStateRow>, String> {
    let uuid_filter = format!("eq.{owner_key}");
    let response = state
        .request(AuthenticatedEndpoint::DailyStreakStates)
        .await?
        .query(&[
            ("select", "current_streak,max_streak,last_submission_key"),
            ("client_uuid", uuid_filter.as_str()),
            ("limit", "1"),
        ])
        .send()
        .await
        .map_err(|error| format!("backend API daily badge fetch failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "backend API daily badge fetch failed with {}",
            response.status()
        ));
    }

    let rows = response
        .json::<Vec<DailyStreakStateRow>>()
        .await
        .map_err(|error| format!("failed to decode daily badge response: {error}"))?;
    Ok(rows.into_iter().next())
}

fn is_current_streak_alive(last_submission_key: Option<&str>, challenge_key: &str) -> bool {
    let Some(last_key) = last_submission_key else {
        return false;
    };
    last_key == challenge_key || is_next_challenge_day(last_key, challenge_key)
}

fn badge_status_from_streaks(current_streak: i64, max_streak: i64) -> DailyBadgeStatus {
    let highest_badge_power = resolve_badge_power(max_streak);
    let highest_badge_days = highest_badge_power.map(|power| 2_i64.pow(power as u32));
    let next_badge_power = match highest_badge_power {
        None => Some(0),
        Some(power) if power >= DAILY_BADGE_MAX_POWER => None,
        Some(power) => Some(power + 1),
    };
    let next_badge_days = next_badge_power.map(|power| 2_i64.pow(power as u32));
    let days_to_next_badge = next_badge_days.map(|days| (days - current_streak).max(0));

    DailyBadgeStatus {
        current_streak,
        max_streak,
        highest_badge_power,
        highest_badge_days,
        next_badge_power,
        next_badge_days,
        days_to_next_badge,
    }
}

fn resolve_badge_power(streak: i64) -> Option<i64> {
    if streak < 1 {
        return None;
    }

    let mut power = 0_i64;
    while power < DAILY_BADGE_MAX_POWER && 2_i64.pow((power + 1) as u32) <= streak {
        power += 1;
    }
    Some(power)
}

fn is_next_challenge_day(previous: &str, next: &str) -> bool {
    let previous_day = challenge_key_to_day_number(previous);
    let next_day = challenge_key_to_day_number(next);
    matches!((previous_day, next_day), (Some(left), Some(right)) if right - left == 1)
}

fn challenge_key_to_day_number(challenge_key: &str) -> Option<i64> {
    if challenge_key.len() != 10 {
        return None;
    }
    let bytes = challenge_key.as_bytes();
    if bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }

    let year = parse_i32_digits(&challenge_key[0..4])?;
    let month = parse_i32_digits(&challenge_key[5..7])?;
    let day = parse_i32_digits(&challenge_key[8..10])?;
    if !(1..=12).contains(&month) {
        return None;
    }

    let max_day = days_in_month(year, month as u32);
    if day < 1 || day as u32 > max_day {
        return None;
    }

    Some(days_from_civil(year, month as u32, day as u32))
}

fn parse_i32_digits(raw: &str) -> Option<i32> {
    if raw.is_empty() || !raw.bytes().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    raw.parse::<i32>().ok()
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let year = year - if month <= 2 { 1 } else { 0 };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let month_index = month as i32 + if month > 2 { -3 } else { 9 };
    let doy = (153 * month_index + 2) / 5 + day as i32 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era * 146_097 + doe - 719_468) as i64
}

async fn start_remote_daily_attempt(
    state: &ClientState,
    challenge_key: &str,
    attempt_token: Option<&str>,
    owner_key: &str,
) -> Result<DailyAttemptStartResult, String> {
    let payload = DailyStartPayload {
        p_client_uuid: owner_key,
        p_challenge_key: challenge_key,
        p_player_name: "Pending",
        p_attempt_token: attempt_token,
    };

    let response = state
        .request(AuthenticatedEndpoint::StartDailyAttempt)
        .await?
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("backend API daily start failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "backend API daily start failed with {}",
            response.status()
        ));
    }

    let result = response
        .json::<DailyAttemptStartResult>()
        .await
        .map_err(|error| format!("failed to decode daily start response: {error}"))?;

    let token = result
        .attempt_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let attempts_left = result.attempts_left.clamp(0, DAILY_MAX_ATTEMPTS);
    Ok(DailyAttemptStartResult {
        accepted: result.accepted,
        resumed: result.resumed,
        attempt_token: token,
        challenge_key: challenge_key.to_string(),
        attempts_used: result.attempts_used.clamp(0, DAILY_MAX_ATTEMPTS),
        attempts_left,
        max_attempts: DAILY_MAX_ATTEMPTS,
        can_submit: attempts_left > 0,
        has_active_attempt: result.has_active_attempt,
    })
}

async fn submit_remote_global_score(
    state: &ClientState,
    entry: &ScoreEntry,
    replay_proof: &DailyReplayProof,
    owner_key: &str,
) -> Result<(), String> {
    let payload = VerifyScorePayload {
        mode: CLASSIC_MODE,
        challenge_key: CLASSIC_CHALLENGE_KEY,
        attempt_token: None,
        client_uuid: owner_key,
        entry,
        replay_proof,
    };

    let response = state
        .request(AuthenticatedEndpoint::VerifyScore)
        .await?
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("backend API global replay verify failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "backend API global replay verify failed with {}",
            response.status()
        ));
    }

    Ok(())
}

async fn submit_remote_daily_score(
    state: &ClientState,
    challenge_key: &str,
    attempt_token: &str,
    entry: &ScoreEntry,
    replay_proof: &DailyReplayProof,
    owner_key: &str,
) -> Result<DailySubmitResult, String> {
    let payload = VerifyScorePayload {
        mode: DAILY_MODE,
        challenge_key,
        attempt_token: Some(attempt_token),
        client_uuid: owner_key,
        entry,
        replay_proof,
    };

    let response = state
        .request(AuthenticatedEndpoint::VerifyScore)
        .await?
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("backend API daily replay verify failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "backend API daily replay verify failed with {}",
            response.status()
        ));
    }

    let result = response
        .json::<DailySubmitResult>()
        .await
        .map_err(|error| format!("failed to decode daily verify response: {error}"))?;
    Ok(DailySubmitResult {
        accepted: result.accepted,
        improved: result.improved,
        challenge_key: challenge_key.to_string(),
        attempts_used: result.attempts_used.clamp(0, DAILY_MAX_ATTEMPTS),
        attempts_left: result.attempts_left.clamp(0, DAILY_MAX_ATTEMPTS),
        max_attempts: DAILY_MAX_ATTEMPTS,
        can_submit: result.attempts_left.clamp(0, DAILY_MAX_ATTEMPTS) > 0,
        has_active_attempt: result.has_active_attempt,
    })
}

async fn forfeit_remote_daily_attempt(
    state: &ClientState,
    challenge_key: &str,
    attempt_token: &str,
    owner_key: &str,
) -> Result<DailyForfeitResult, String> {
    let payload = DailyForfeitPayload {
        p_client_uuid: owner_key,
        p_challenge_key: challenge_key,
        p_attempt_token: attempt_token,
    };

    let response = state
        .request(AuthenticatedEndpoint::ForfeitDailyAttempt)
        .await?
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("backend API daily forfeit failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "backend API daily forfeit failed with {}",
            response.status()
        ));
    }

    let result = response
        .json::<DailyForfeitResult>()
        .await
        .map_err(|error| format!("failed to decode daily forfeit response: {error}"))?;

    let attempts_left = result.attempts_left.clamp(0, DAILY_MAX_ATTEMPTS);
    Ok(DailyForfeitResult {
        accepted: result.accepted,
        challenge_key: challenge_key.to_string(),
        attempts_used: result.attempts_used.clamp(0, DAILY_MAX_ATTEMPTS),
        attempts_left,
        max_attempts: DAILY_MAX_ATTEMPTS,
        can_submit: attempts_left > 0,
        has_active_attempt: result.has_active_attempt,
    })
}

async fn rollback_remote_daily_attempt(
    state: &ClientState,
    challenge_key: &str,
    attempt_token: &str,
    owner_key: &str,
) -> Result<DailyForfeitResult, String> {
    let payload = DailyForfeitPayload {
        p_client_uuid: owner_key,
        p_challenge_key: challenge_key,
        p_attempt_token: attempt_token,
    };

    let response = state
        .request(AuthenticatedEndpoint::RollbackDailyAttempt)
        .await?
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("backend API daily rollback failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "backend API daily rollback failed with {}",
            response.status()
        ));
    }

    let result = response
        .json::<DailyForfeitResult>()
        .await
        .map_err(|error| format!("failed to decode daily rollback response: {error}"))?;

    let attempts_left = result.attempts_left.clamp(0, DAILY_MAX_ATTEMPTS);
    Ok(DailyForfeitResult {
        accepted: result.accepted,
        challenge_key: challenge_key.to_string(),
        attempts_used: result.attempts_used.clamp(0, DAILY_MAX_ATTEMPTS),
        attempts_left,
        max_attempts: DAILY_MAX_ATTEMPTS,
        can_submit: attempts_left > 0,
        has_active_attempt: result.has_active_attempt,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        challenge_key_to_day_number, is_next_challenge_day, is_owned_by_owner,
        normalize_daily_attempt_token_candidate, DailyStartPayload,
    };
    use serde_json::json;

    #[test]
    fn daily_start_payload_only_sends_a_resume_token_when_supplied() {
        let fresh = serde_json::to_value(DailyStartPayload {
            p_client_uuid: "owner",
            p_challenge_key: "2026-09-03",
            p_player_name: "Pending",
            p_attempt_token: None,
        })
        .unwrap();
        assert_eq!(
            fresh,
            json!({
                "p_client_uuid": "owner",
                "p_challenge_key": "2026-09-03",
                "p_player_name": "Pending"
            })
        );

        let resumed = serde_json::to_value(DailyStartPayload {
            p_client_uuid: "owner",
            p_challenge_key: "2026-09-03",
            p_player_name: "Pending",
            p_attempt_token: Some("raw-token"),
        })
        .unwrap();
        assert_eq!(resumed["p_attempt_token"], "raw-token");
    }

    #[test]
    fn daily_resume_token_candidates_are_trimmed_and_bounded() {
        assert_eq!(normalize_daily_attempt_token_candidate(None).unwrap(), None);
        assert_eq!(
            normalize_daily_attempt_token_candidate(Some("  ".into())).unwrap(),
            None
        );
        assert_eq!(
            normalize_daily_attempt_token_candidate(Some("  raw-token  ".into())).unwrap(),
            Some("raw-token".into())
        );
        assert!(normalize_daily_attempt_token_candidate(Some("x".repeat(257))).is_err());
    }

    #[test]
    fn legacy_and_authenticated_owner_ids_both_mark_historical_rows() {
        let owners = vec![
            "legacy-device-id".to_string(),
            "new-installation-id".to_string(),
        ];
        assert!(is_owned_by_owner(Some("legacy-device-id"), &owners));
        assert!(is_owned_by_owner(Some("new-installation-id"), &owners));
        assert!(!is_owned_by_owner(Some("another-owner"), &owners));
        assert!(!is_owned_by_owner(None, &owners));
    }

    #[test]
    fn challenge_days_are_consecutive_across_calendar_boundaries() {
        let consecutive_pairs = [
            ("2025-01-31", "2025-02-01"),
            ("2025-04-30", "2025-05-01"),
            ("2025-12-31", "2026-01-01"),
        ];

        for (previous, next) in consecutive_pairs {
            assert!(
                is_next_challenge_day(previous, next),
                "expected {next} to follow {previous}"
            );
        }
    }

    #[test]
    fn challenge_days_handle_leap_year_rules() {
        assert!(is_next_challenge_day("2024-02-28", "2024-02-29"));
        assert!(is_next_challenge_day("2024-02-29", "2024-03-01"));
        assert!(is_next_challenge_day("2000-02-28", "2000-02-29"));
        assert!(is_next_challenge_day("1900-02-28", "1900-03-01"));
        assert_eq!(challenge_key_to_day_number("1900-02-29"), None);
    }

    #[test]
    fn challenge_day_parser_rejects_invalid_dates_and_formats() {
        let invalid_keys = [
            "2023-02-29",
            "2024-02-30",
            "2025-04-31",
            "2025-00-10",
            "2025-13-10",
            "2025-01-00",
            "2025-1-01",
            "2025/01/01",
            "not-a-date",
        ];

        for challenge_key in invalid_keys {
            assert_eq!(
                challenge_key_to_day_number(challenge_key),
                None,
                "expected {challenge_key} to be rejected"
            );
        }
    }
}
