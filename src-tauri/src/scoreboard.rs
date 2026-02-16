use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const CACHE_FILE_NAME: &str = "scoreboard-global-cache-v1.json";
const DEVICE_UUID_FILE_NAME: &str = "device-uuid-v1.txt";
const CACHE_MAX_ENTRIES: usize = 100;
const DEFAULT_TOP_LIMIT: usize = 10;
const MAX_TOP_LIMIT: usize = 100;
const HTTP_TIMEOUT_SECONDS: u64 = 8;
const MAX_SKILL_USAGE_ITEMS: usize = 20;
const MAX_SKILL_NAME_LEN: usize = 20;
const MAX_SKILL_HOTKEY_LEN: usize = 16;
const MAX_SKILL_COMMAND_LEN: usize = 120;
const CLASSIC_MODE: &str = "classic";
const DAILY_MODE: &str = "daily";
const CLASSIC_CHALLENGE_KEY: &str = "classic";
const DAILY_MAX_ATTEMPTS: i64 = 3;
const DAILY_RPC_NAME: &str = "submit_daily_score";

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
}

#[derive(Debug, Serialize)]
struct SubmitScorePayload<'a> {
    player_name: &'a str,
    score: i64,
    level: i64,
    created_at: &'a str,
    client_uuid: &'a str,
    skill_usage: &'a [SkillUsage],
    mode: &'a str,
    challenge_key: &'a str,
}

#[derive(Debug, Clone)]
struct SupabaseConfig {
    url: String,
    anon_key: String,
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
}

#[derive(Debug, Serialize)]
struct DailySubmitPayload<'a> {
    p_client_uuid: &'a str,
    p_challenge_key: &'a str,
    p_player_name: &'a str,
    p_score: i64,
    p_level: i64,
    p_created_at: &'a str,
    p_skill_usage: &'a [SkillUsage],
}

#[tauri::command]
pub async fn fetch_global_scores(
    app: AppHandle,
    limit: Option<u32>,
    supabase_url: Option<String>,
    supabase_anon_key: Option<String>,
) -> Result<Vec<ScoreEntry>, String> {
    let top_limit = normalize_limit(limit);
    let mut cache = read_cache(&app)?;
    let device_uuid = match get_or_create_device_uuid(&app) {
        Ok(value) => Some(value),
        Err(error) => {
            eprintln!("Failed to resolve device UUID. {error}");
            None
        }
    };
    let config = normalize_supabase_config(supabase_url, supabase_anon_key);

    if let Some(config) = config {
        match fetch_remote_scores(&config, top_limit, device_uuid.as_deref()).await {
            Ok(remote_entries) => {
                cache.extend(remote_entries.clone());
                sort_and_dedupe(&mut cache);
                truncate_cache(&mut cache);
                write_cache(&app, &cache)?;
                return Ok(remote_entries);
            }
            Err(error) => {
                eprintln!("Failed to load scores from Supabase. Using local cache. {error}");
            }
        }
    }

    sort_and_dedupe(&mut cache);
    Ok(cache.into_iter().take(top_limit).collect())
}

#[tauri::command]
pub async fn submit_global_score(
    app: AppHandle,
    entry: ScoreEntry,
    supabase_url: Option<String>,
    supabase_anon_key: Option<String>,
) -> Result<(), String> {
    let mut cache = read_cache(&app)?;
    let mut entry = sanitize_entry(entry)?;
    let device_uuid = get_or_create_device_uuid(&app)?;
    entry.is_me = true;
    cache.push(entry.clone());
    sort_and_dedupe(&mut cache);
    truncate_cache(&mut cache);
    write_cache(&app, &cache)?;

    if let Some(config) = normalize_supabase_config(supabase_url, supabase_anon_key) {
        if let Err(error) = upsert_remote_score(&config, &entry, &device_uuid).await {
            eprintln!("Failed to save score to Supabase. Score kept locally. {error}");
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn fetch_daily_scores(
    app: AppHandle,
    challenge_key: String,
    limit: Option<u32>,
    supabase_url: Option<String>,
    supabase_anon_key: Option<String>,
) -> Result<Vec<ScoreEntry>, String> {
    let top_limit = normalize_limit(limit);
    let normalized_challenge_key = normalize_daily_challenge_key(&challenge_key)?;
    let config = normalize_supabase_config(supabase_url, supabase_anon_key)
        .ok_or_else(|| "daily challenge sync requires Supabase configuration".to_string())?;
    let device_uuid = match get_or_create_device_uuid(&app) {
        Ok(value) => Some(value),
        Err(error) => {
            eprintln!("Failed to resolve device UUID. {error}");
            None
        }
    };
    fetch_remote_daily_scores(
        &config,
        &normalized_challenge_key,
        top_limit,
        device_uuid.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn fetch_daily_status(
    app: AppHandle,
    challenge_key: String,
    supabase_url: Option<String>,
    supabase_anon_key: Option<String>,
) -> Result<DailyStatus, String> {
    let normalized_challenge_key = normalize_daily_challenge_key(&challenge_key)?;
    let config = normalize_supabase_config(supabase_url, supabase_anon_key)
        .ok_or_else(|| "daily challenge sync requires Supabase configuration".to_string())?;
    let device_uuid = get_or_create_device_uuid(&app)?;
    let attempts_used =
        fetch_remote_daily_attempts(&config, &normalized_challenge_key, &device_uuid).await?;
    Ok(build_daily_status(&normalized_challenge_key, attempts_used))
}

#[tauri::command]
pub async fn submit_daily_score(
    app: AppHandle,
    challenge_key: String,
    entry: ScoreEntry,
    supabase_url: Option<String>,
    supabase_anon_key: Option<String>,
) -> Result<DailySubmitResult, String> {
    let normalized_challenge_key = normalize_daily_challenge_key(&challenge_key)?;
    let config = normalize_supabase_config(supabase_url, supabase_anon_key)
        .ok_or_else(|| "daily challenge sync requires Supabase configuration".to_string())?;
    let entry = sanitize_entry(entry)?;
    let device_uuid = get_or_create_device_uuid(&app)?;
    submit_remote_daily_score(&config, &normalized_challenge_key, &entry, &device_uuid).await
}

fn normalize_limit(limit: Option<u32>) -> usize {
    let raw = limit.unwrap_or(DEFAULT_TOP_LIMIT as u32);
    raw.clamp(1, MAX_TOP_LIMIT as u32) as usize
}

fn normalize_supabase_config(
    supabase_url: Option<String>,
    supabase_anon_key: Option<String>,
) -> Option<SupabaseConfig> {
    let url = supabase_url
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())?;
    let anon_key = supabase_anon_key
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())?;

    Some(SupabaseConfig { url, anon_key })
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

fn build_daily_status(challenge_key: &str, attempts_used: i64) -> DailyStatus {
    let used = attempts_used.clamp(0, DAILY_MAX_ATTEMPTS);
    let left = DAILY_MAX_ATTEMPTS - used;
    DailyStatus {
        challenge_key: challenge_key.to_string(),
        attempts_used: used,
        attempts_left: left,
        max_attempts: DAILY_MAX_ATTEMPTS,
        can_submit: left > 0,
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
            .map(|value| value.trim().chars().take(MAX_SKILL_HOTKEY_LEN).collect::<String>())
            .and_then(|value| if value.is_empty() { None } else { Some(value) });

        let command = usage
            .command
            .map(|value| {
                value
                    .trim()
                    .chars()
                    .take(MAX_SKILL_COMMAND_LEN)
                    .collect::<String>()
            })
            .and_then(|value| if value.is_empty() { None } else { Some(value) });

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
        skill_usage,
        is_me: false,
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

fn get_or_create_device_uuid(app: &AppHandle) -> Result<String, String> {
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

fn create_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECONDS))
        .build()
        .map_err(|error| format!("failed to build http client: {error}"))
}

async fn fetch_remote_scores(
    config: &SupabaseConfig,
    limit: usize,
    device_uuid: Option<&str>,
) -> Result<Vec<ScoreEntry>, String> {
    let endpoint = format!("{}/rest/v1/scores", config.url.trim_end_matches('/'));
    let client = create_http_client()?;
    let request = client
        .get(endpoint)
        .query(&[
            (
                "select",
                "player_name,score,level,created_at,skill_usage,client_uuid",
            ),
            ("mode", "eq.classic"),
            ("challenge_key", "eq.classic"),
            ("order", "score.desc,level.desc,created_at.desc"),
            ("limit", &limit.to_string()),
        ])
        .header("apikey", &config.anon_key)
        .header("Authorization", format!("Bearer {}", config.anon_key));

    let response = request
        .send()
        .await
        .map_err(|error| format!("supabase request failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("supabase request failed with {status}: {body}"));
    }

    let rows = response
        .json::<Vec<ScoreRow>>()
        .await
        .map_err(|error| format!("failed to decode supabase response: {error}"))?;

    Ok(rows
        .into_iter()
        .map(|row| ScoreEntry {
            user: row.player_name,
            score: row.score,
            level: row.level,
            date: row.created_at,
            skill_usage: row.skill_usage.unwrap_or_default(),
            is_me: is_owned_by_device(row.client_uuid.as_deref(), device_uuid),
        })
        .collect())
}

async fn upsert_remote_score(
    config: &SupabaseConfig,
    entry: &ScoreEntry,
    client_uuid: &str,
) -> Result<(), String> {
    if let Some(existing) = fetch_remote_score_by_uuid(config, client_uuid).await? {
        if !is_better_score(entry, &existing) {
            return Ok(());
        }
        return update_remote_score(config, entry, client_uuid).await;
    }

    insert_remote_score(config, entry, client_uuid).await
}

async fn fetch_remote_score_by_uuid(
    config: &SupabaseConfig,
    client_uuid: &str,
) -> Result<Option<ScoreEntry>, String> {
    let endpoint = format!("{}/rest/v1/scores", config.url.trim_end_matches('/'));
    let filter = format!("eq.{client_uuid}");
    let client = create_http_client()?;
    let response = client
        .get(endpoint)
        .query(&[
            ("select", "player_name,score,level,created_at,skill_usage"),
            ("client_uuid", filter.as_str()),
            ("mode", "eq.classic"),
            ("challenge_key", "eq.classic"),
            ("limit", "1"),
        ])
        .header("apikey", &config.anon_key)
        .header("Authorization", format!("Bearer {}", config.anon_key))
        .send()
        .await
        .map_err(|error| format!("supabase select by uuid failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "supabase select by uuid failed with {status}: {body}"
        ));
    }

    let rows = response
        .json::<Vec<ScoreRow>>()
        .await
        .map_err(|error| format!("failed to decode supabase response: {error}"))?;

    Ok(rows.into_iter().next().map(|row| ScoreEntry {
        user: row.player_name,
        score: row.score,
        level: row.level,
        date: row.created_at,
        skill_usage: row.skill_usage.unwrap_or_default(),
        is_me: true,
    }))
}

async fn insert_remote_score(
    config: &SupabaseConfig,
    entry: &ScoreEntry,
    client_uuid: &str,
) -> Result<(), String> {
    let endpoint = format!("{}/rest/v1/scores", config.url.trim_end_matches('/'));
    let payload = SubmitScorePayload {
        player_name: &entry.user,
        score: entry.score,
        level: entry.level,
        created_at: &entry.date,
        client_uuid,
        skill_usage: &entry.skill_usage,
        mode: CLASSIC_MODE,
        challenge_key: CLASSIC_CHALLENGE_KEY,
    };

    let client = create_http_client()?;
    let response = client
        .post(endpoint)
        .header("apikey", &config.anon_key)
        .header("Authorization", format!("Bearer {}", config.anon_key))
        .header("Prefer", "return=minimal")
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("supabase insert failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("supabase insert failed with {status}: {body}"));
    }

    Ok(())
}

async fn update_remote_score(
    config: &SupabaseConfig,
    entry: &ScoreEntry,
    client_uuid: &str,
) -> Result<(), String> {
    let endpoint = format!("{}/rest/v1/scores", config.url.trim_end_matches('/'));
    let filter = format!("eq.{client_uuid}");
    let payload = SubmitScorePayload {
        player_name: &entry.user,
        score: entry.score,
        level: entry.level,
        created_at: &entry.date,
        client_uuid,
        skill_usage: &entry.skill_usage,
        mode: CLASSIC_MODE,
        challenge_key: CLASSIC_CHALLENGE_KEY,
    };

    let client = create_http_client()?;
    let response = client
        .patch(endpoint)
        .query(&[
            ("client_uuid", filter.as_str()),
            ("mode", "eq.classic"),
            ("challenge_key", "eq.classic"),
        ])
        .header("apikey", &config.anon_key)
        .header("Authorization", format!("Bearer {}", config.anon_key))
        .header("Prefer", "return=minimal")
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("supabase update failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("supabase update failed with {status}: {body}"));
    }

    Ok(())
}

async fn fetch_remote_daily_scores(
    config: &SupabaseConfig,
    challenge_key: &str,
    limit: usize,
    device_uuid: Option<&str>,
) -> Result<Vec<ScoreEntry>, String> {
    let endpoint = format!("{}/rest/v1/scores", config.url.trim_end_matches('/'));
    let mode_filter = format!("eq.{DAILY_MODE}");
    let challenge_filter = format!("eq.{challenge_key}");
    let client = create_http_client()?;
    let response = client
        .get(endpoint)
        .query(&[
            (
                "select",
                "player_name,score,level,created_at,skill_usage,client_uuid",
            ),
            ("mode", mode_filter.as_str()),
            ("challenge_key", challenge_filter.as_str()),
            ("order", "score.desc,level.desc,created_at.desc"),
            ("limit", &limit.to_string()),
        ])
        .header("apikey", &config.anon_key)
        .header("Authorization", format!("Bearer {}", config.anon_key))
        .send()
        .await
        .map_err(|error| format!("supabase daily fetch failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("supabase daily fetch failed with {status}: {body}"));
    }

    let rows = response
        .json::<Vec<ScoreRow>>()
        .await
        .map_err(|error| format!("failed to decode supabase response: {error}"))?;

    Ok(rows
        .into_iter()
        .map(|row| ScoreEntry {
            user: row.player_name,
            score: row.score,
            level: row.level,
            date: row.created_at,
            skill_usage: row.skill_usage.unwrap_or_default(),
            is_me: is_owned_by_device(row.client_uuid.as_deref(), device_uuid),
        })
        .collect())
}

fn is_owned_by_device(row_client_uuid: Option<&str>, device_uuid: Option<&str>) -> bool {
    matches!(
        (row_client_uuid, device_uuid),
        (Some(row_uuid), Some(device_uuid)) if row_uuid == device_uuid
    )
}

async fn fetch_remote_daily_attempts(
    config: &SupabaseConfig,
    challenge_key: &str,
    client_uuid: &str,
) -> Result<i64, String> {
    let endpoint = format!("{}/rest/v1/scores", config.url.trim_end_matches('/'));
    let mode_filter = format!("eq.{DAILY_MODE}");
    let challenge_filter = format!("eq.{challenge_key}");
    let uuid_filter = format!("eq.{client_uuid}");
    let client = create_http_client()?;
    let response = client
        .get(endpoint)
        .query(&[
            ("select", "attempts_used"),
            ("mode", mode_filter.as_str()),
            ("challenge_key", challenge_filter.as_str()),
            ("client_uuid", uuid_filter.as_str()),
            ("limit", "1"),
        ])
        .header("apikey", &config.anon_key)
        .header("Authorization", format!("Bearer {}", config.anon_key))
        .send()
        .await
        .map_err(|error| format!("supabase daily status fetch failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "supabase daily status fetch failed with {status}: {body}"
        ));
    }

    let rows = response
        .json::<Vec<DailyAttemptsRow>>()
        .await
        .map_err(|error| format!("failed to decode supabase response: {error}"))?;
    let attempts = rows
        .into_iter()
        .next()
        .and_then(|row| row.attempts_used)
        .unwrap_or(0);
    Ok(attempts.clamp(0, DAILY_MAX_ATTEMPTS))
}

async fn submit_remote_daily_score(
    config: &SupabaseConfig,
    challenge_key: &str,
    entry: &ScoreEntry,
    client_uuid: &str,
) -> Result<DailySubmitResult, String> {
    let endpoint = format!(
        "{}/rest/v1/rpc/{}",
        config.url.trim_end_matches('/'),
        DAILY_RPC_NAME
    );
    let payload = DailySubmitPayload {
        p_client_uuid: client_uuid,
        p_challenge_key: challenge_key,
        p_player_name: &entry.user,
        p_score: entry.score,
        p_level: entry.level,
        p_created_at: &entry.date,
        p_skill_usage: &entry.skill_usage,
    };

    let client = create_http_client()?;
    let response = client
        .post(endpoint)
        .header("apikey", &config.anon_key)
        .header("Authorization", format!("Bearer {}", config.anon_key))
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("supabase daily submit failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "supabase daily submit failed with {status}: {body}\n\
Ensure /supabase/schema.sql has been applied (including RPC {DAILY_RPC_NAME})."
        ));
    }

    let result = response
        .json::<DailySubmitResult>()
        .await
        .map_err(|error| format!("failed to decode daily submit response: {error}"))?;
    Ok(DailySubmitResult {
        accepted: result.accepted,
        improved: result.improved,
        challenge_key: challenge_key.to_string(),
        attempts_used: result.attempts_used.clamp(0, DAILY_MAX_ATTEMPTS),
        attempts_left: result.attempts_left.clamp(0, DAILY_MAX_ATTEMPTS),
        max_attempts: DAILY_MAX_ATTEMPTS,
        can_submit: result.attempts_left.clamp(0, DAILY_MAX_ATTEMPTS) > 0,
    })
}

fn is_better_score(incoming: &ScoreEntry, existing: &ScoreEntry) -> bool {
    if incoming.score != existing.score {
        return incoming.score > existing.score;
    }

    incoming.level > existing.level
}
