#[cfg(target_os = "android")]
compile_error!("authenticated online scoreboards require an Android OS credential vault");

use async_trait::async_trait;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use reqwest::{
    header::{HeaderValue, AUTHORIZATION},
    Method, RequestBuilder, StatusCode,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

const VAULT_SERVICE: &str = "com.u-keunsong.Torus.installation-credentials";
const VAULT_ACCOUNT_VERSION: &str = "ti1";
const ENROLL_PATH: &str = "/v1/installations/enroll";
const HTTP_TIMEOUT_SECONDS: u64 = 8;
const AUTH_SCHEME: &str = "TorusInstall";
const AUTH_VERSION: &str = "ti1";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CredentialRecord {
    version: u8,
    installation_id: String,
    secret: String,
    enrolled: bool,
}

impl CredentialRecord {
    fn generate() -> Self {
        let mut bytes = [0_u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        Self {
            version: 1,
            installation_id: Uuid::new_v4().to_string(),
            secret: URL_SAFE_NO_PAD.encode(bytes),
            enrolled: false,
        }
    }

    fn authorization(&self) -> HeaderValue {
        let mut value = HeaderValue::from_str(&format!(
            "{AUTH_SCHEME} {AUTH_VERSION}.{}.{}",
            self.installation_id, self.secret
        ))
        .expect("generated installation credentials are valid header characters");
        value.set_sensitive(true);
        value
    }

    fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err("vault contains an invalid installation credential".into());
        }
        let id = Uuid::parse_str(&self.installation_id)
            .map_err(|_| "vault contains an invalid installation credential".to_string())?;
        if id.get_version_num() != 4 || id.to_string() != self.installation_id {
            return Err("vault contains an invalid installation credential".into());
        }
        let decoded = URL_SAFE_NO_PAD
            .decode(&self.secret)
            .map_err(|_| "vault contains an invalid installation credential".to_string())?;
        if decoded.len() != 32 || URL_SAFE_NO_PAD.encode(&decoded) != self.secret {
            return Err("vault contains an invalid installation credential".into());
        }
        Ok(())
    }
}

trait CredentialVault: Send + Sync {
    fn load(&self) -> Result<Option<CredentialRecord>, String>;
    fn store(&self, record: &CredentialRecord) -> Result<(), String>;
}

struct OsCredentialVault {
    account: String,
}

impl CredentialVault for OsCredentialVault {
    fn load(&self) -> Result<Option<CredentialRecord>, String> {
        let entry = keyring::Entry::new(VAULT_SERVICE, &self.account)
            .map_err(|_| "failed to open installation credential vault".to_string())?;
        match entry.get_password() {
            Ok(raw) => {
                let record: CredentialRecord = serde_json::from_str(&raw)
                    .map_err(|_| "installation credential vault data is invalid".to_string())?;
                record.validate()?;
                Ok(Some(record))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("failed to read installation credential vault".into()),
        }
    }

    fn store(&self, record: &CredentialRecord) -> Result<(), String> {
        record.validate()?;
        let raw = serde_json::to_string(record)
            .map_err(|_| "failed to encode installation credential".to_string())?;
        let entry = keyring::Entry::new(VAULT_SERVICE, &self.account)
            .map_err(|_| "failed to open installation credential vault".to_string())?;
        entry
            .set_password(&raw)
            .map_err(|_| "failed to store installation credential in OS vault".to_string())
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum EnrollmentResult {
    Enrolled,
    Conflict,
    Failed,
}

#[async_trait]
trait EnrollmentClient: Send + Sync {
    async fn enroll(&self, record: &CredentialRecord) -> EnrollmentResult;
}

struct HttpEnrollmentClient {
    base_url: String,
    client: reqwest::Client,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnrollmentPayload<'a> {
    installation_id: &'a str,
    secret: &'a str,
}

#[async_trait]
impl EnrollmentClient for HttpEnrollmentClient {
    async fn enroll(&self, record: &CredentialRecord) -> EnrollmentResult {
        let response = self
            .client
            .post(format!("{}{ENROLL_PATH}", self.base_url))
            .json(&EnrollmentPayload {
                installation_id: &record.installation_id,
                secret: &record.secret,
            })
            .send()
            .await;
        match response {
            Ok(value) if matches!(value.status(), StatusCode::OK | StatusCode::CREATED) => {
                EnrollmentResult::Enrolled
            }
            Ok(value) if value.status() == StatusCode::CONFLICT => EnrollmentResult::Conflict,
            _ => EnrollmentResult::Failed,
        }
    }
}

#[derive(Clone, Copy)]
pub enum PublicEndpoint {
    Scores,
    DailyStreakStates,
}

impl PublicEndpoint {
    fn path(self) -> &'static str {
        match self {
            Self::Scores => "/rest/v1/scores",
            Self::DailyStreakStates => "/rest/v1/daily_streak_states",
        }
    }
}

#[derive(Clone, Copy)]
pub enum AuthenticatedEndpoint {
    Scores,
    DailyStreakStates,
    StartDailyAttempt,
    ForfeitDailyAttempt,
    RollbackDailyAttempt,
    VerifyScore,
}

impl AuthenticatedEndpoint {
    fn policy(self) -> (Method, &'static str, bool) {
        match self {
            Self::Scores => (Method::GET, "/rest/v1/scores", false),
            Self::DailyStreakStates => (Method::GET, "/rest/v1/daily_streak_states", false),
            Self::StartDailyAttempt => (Method::POST, "/rest/v1/rpc/start_daily_attempt", true),
            Self::ForfeitDailyAttempt => (Method::POST, "/rest/v1/rpc/forfeit_daily_attempt", true),
            Self::RollbackDailyAttempt => {
                (Method::POST, "/rest/v1/rpc/rollback_daily_attempt", true)
            }
            Self::VerifyScore => (Method::POST, "/functions/v1/verify-score", true),
        }
    }
}

pub struct ClientState {
    base_url: String,
    client: reqwest::Client,
    vault: Arc<dyn CredentialVault>,
    enrollment: Arc<dyn EnrollmentClient>,
    enrollment_lock: AsyncMutex<()>,
    credential_cache: Mutex<Option<CredentialRecord>>,
    pub device_uuid_lock: Mutex<()>,
}

impl ClientState {
    pub fn production() -> Result<Self, String> {
        let base_url = env!("TORUS_API_BASE_URL").to_string();
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SECONDS))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "failed to build HTTP client".to_string())?;
        Ok(Self {
            base_url: base_url.clone(),
            client: client.clone(),
            vault: Arc::new(OsCredentialVault {
                account: format!("{VAULT_ACCOUNT_VERSION}:{base_url}"),
            }),
            enrollment: Arc::new(HttpEnrollmentClient { base_url, client }),
            enrollment_lock: AsyncMutex::new(()),
            credential_cache: Mutex::new(None),
            device_uuid_lock: Mutex::new(()),
        })
    }

    pub async fn request(&self, endpoint: AuthenticatedEndpoint) -> Result<RequestBuilder, String> {
        let (method, relative_path, mutation) = endpoint.policy();
        let record = self.ensure_enrolled().await?;
        let mut request = self
            .client
            .request(method, format!("{}{}", self.base_url, relative_path))
            .header(AUTHORIZATION, record.authorization());
        if mutation {
            request = request
                .header("x-torus-timestamp", unix_timestamp().to_string())
                .header("x-torus-request-id", Uuid::new_v4().to_string());
        }
        Ok(request)
    }

    pub async fn owner_id(&self) -> Result<String, String> {
        Ok(self.ensure_enrolled().await?.installation_id)
    }

    pub fn public_request(&self, endpoint: PublicEndpoint) -> RequestBuilder {
        self.client
            .request(Method::GET, format!("{}{}", self.base_url, endpoint.path()))
    }

    async fn ensure_enrolled(&self) -> Result<CredentialRecord, String> {
        let _guard = self.enrollment_lock.lock().await;
        if let Some(record) = self
            .credential_cache
            .lock()
            .map_err(|_| "installation credential cache is unavailable".to_string())?
            .clone()
        {
            return Ok(record);
        }
        let mut record = match self.load_vault().await? {
            Some(value) => value,
            None => {
                let created = CredentialRecord::generate();
                self.store_vault(created.clone()).await?;
                created
            }
        };
        if !record.enrolled {
            match self.enrollment.enroll(&record).await {
                EnrollmentResult::Enrolled => {
                    record.enrolled = true;
                    self.store_vault(record.clone()).await?;
                }
                EnrollmentResult::Conflict => {
                    return Err("installation enrollment conflict".into());
                }
                EnrollmentResult::Failed => {
                    return Err("installation enrollment is temporarily unavailable".into());
                }
            }
        }
        *self
            .credential_cache
            .lock()
            .map_err(|_| "installation credential cache is unavailable".to_string())? =
            Some(record.clone());
        Ok(record)
    }

    async fn load_vault(&self) -> Result<Option<CredentialRecord>, String> {
        let vault = Arc::clone(&self.vault);
        tokio::task::spawn_blocking(move || vault.load())
            .await
            .map_err(|_| "installation credential vault task failed".to_string())?
    }

    async fn store_vault(&self, record: CredentialRecord) -> Result<(), String> {
        let vault = Arc::clone(&self.vault);
        tokio::task::spawn_blocking(move || vault.store(&record))
            .await
            .map_err(|_| "installation credential vault task failed".to_string())?
    }
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Default)]
    struct MemoryVault(Mutex<Option<CredentialRecord>>);
    impl CredentialVault for MemoryVault {
        fn load(&self) -> Result<Option<CredentialRecord>, String> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn store(&self, value: &CredentialRecord) -> Result<(), String> {
            *self.0.lock().unwrap() = Some(value.clone());
            Ok(())
        }
    }

    struct FakeEnrollment {
        result: EnrollmentResult,
        calls: AtomicUsize,
    }
    #[async_trait]
    impl EnrollmentClient for FakeEnrollment {
        async fn enroll(&self, _record: &CredentialRecord) -> EnrollmentResult {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.result
        }
    }

    fn state(vault: Arc<MemoryVault>, enrollment: Arc<FakeEnrollment>) -> ClientState {
        ClientState {
            base_url: "https://example.invalid".into(),
            client: reqwest::Client::new(),
            vault,
            enrollment,
            enrollment_lock: AsyncMutex::new(()),
            credential_cache: Mutex::new(None),
            device_uuid_lock: Mutex::new(()),
        }
    }

    #[test]
    #[ignore = "touches the host OS credential vault"]
    fn os_credential_vault_round_trip() {
        let account = format!("smoke:{}", Uuid::new_v4());
        let vault = OsCredentialVault {
            account: account.clone(),
        };
        let mut expected = CredentialRecord::generate();
        expected.enrolled = true;
        vault.store(&expected).unwrap();
        let loaded = vault.load().unwrap().unwrap();
        assert_eq!(loaded.installation_id, expected.installation_id);
        assert_eq!(loaded.secret, expected.secret);
        assert!(loaded.enrolled);
        keyring::Entry::new(VAULT_SERVICE, &account)
            .unwrap()
            .delete_credential()
            .unwrap();
        assert!(vault.load().unwrap().is_none());
    }

    #[test]
    fn generated_credentials_have_uuid_v4_and_32_byte_secret() {
        let value = CredentialRecord::generate();
        assert_eq!(
            Uuid::parse_str(&value.installation_id)
                .unwrap()
                .get_version_num(),
            4
        );
        assert_eq!(URL_SAFE_NO_PAD.decode(&value.secret).unwrap().len(), 32);
        assert!(!value.enrolled);
    }

    #[tokio::test]
    async fn transient_failure_keeps_the_same_unenrolled_record_for_retry() {
        let vault = Arc::new(MemoryVault::default());
        let enrollment = Arc::new(FakeEnrollment {
            result: EnrollmentResult::Failed,
            calls: AtomicUsize::new(0),
        });
        let state = state(vault.clone(), enrollment.clone());
        assert!(state.ensure_enrolled().await.is_err());
        let first = vault.load().unwrap().unwrap();
        assert!(state.ensure_enrolled().await.is_err());
        let second = vault.load().unwrap().unwrap();
        assert_eq!(first.installation_id, second.installation_id);
        assert!(first.secret == second.secret);
        assert_eq!(enrollment.calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn success_marks_the_existing_record_enrolled() {
        let vault = Arc::new(MemoryVault::default());
        let enrollment = Arc::new(FakeEnrollment {
            result: EnrollmentResult::Enrolled,
            calls: AtomicUsize::new(0),
        });
        let state = state(vault.clone(), enrollment.clone());
        let result = state.ensure_enrolled().await.unwrap();
        assert!(result.enrolled);
        assert!(vault.load().unwrap().unwrap().enrolled);
        let _ = state.ensure_enrolled().await.unwrap();
        assert_eq!(enrollment.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn conflict_fails_closed_without_rotation() {
        let vault = Arc::new(MemoryVault::default());
        let enrollment = Arc::new(FakeEnrollment {
            result: EnrollmentResult::Conflict,
            calls: AtomicUsize::new(0),
        });
        let state = state(vault.clone(), enrollment);
        assert_eq!(
            state.ensure_enrolled().await.err().unwrap(),
            "installation enrollment conflict"
        );
        let first = vault.load().unwrap().unwrap();
        assert_eq!(
            state.ensure_enrolled().await.err().unwrap(),
            "installation enrollment conflict"
        );
        let second = vault.load().unwrap().unwrap();
        assert_eq!(first.installation_id, second.installation_id);
        assert!(first.secret == second.secret);
    }
    #[tokio::test]
    async fn request_headers_distinguish_private_reads_and_mutations() {
        let mut record = CredentialRecord::generate();
        record.enrolled = true;
        let vault = Arc::new(MemoryVault(Mutex::new(Some(record))));
        let enrollment = Arc::new(FakeEnrollment {
            result: EnrollmentResult::Failed,
            calls: AtomicUsize::new(0),
        });
        let state = state(vault, enrollment);
        let read = state
            .request(AuthenticatedEndpoint::Scores)
            .await
            .unwrap()
            .build()
            .unwrap();
        assert!(read.headers().contains_key(AUTHORIZATION));
        assert!(!read.headers().contains_key("x-torus-timestamp"));
        assert!(!read.headers().contains_key("x-torus-request-id"));
        let write = state
            .request(AuthenticatedEndpoint::VerifyScore)
            .await
            .unwrap()
            .build()
            .unwrap();
        assert!(write.headers().contains_key(AUTHORIZATION));
        assert!(write.headers().get(AUTHORIZATION).unwrap().is_sensitive());
        assert!(write
            .headers()
            .get("x-torus-timestamp")
            .unwrap()
            .to_str()
            .unwrap()
            .parse::<u64>()
            .is_ok());
        let first_request_id = write
            .headers()
            .get("x-torus-request-id")
            .unwrap()
            .to_str()
            .unwrap();
        Uuid::parse_str(first_request_id).unwrap();
        let second_write = state
            .request(AuthenticatedEndpoint::VerifyScore)
            .await
            .unwrap()
            .build()
            .unwrap();
        assert_ne!(
            first_request_id,
            second_write
                .headers()
                .get("x-torus-request-id")
                .unwrap()
                .to_str()
                .unwrap()
        );
    }

    #[tokio::test]
    async fn endpoint_policy_covers_all_authenticated_routes() {
        let mut record = CredentialRecord::generate();
        record.enrolled = true;
        let vault = Arc::new(MemoryVault(Mutex::new(Some(record))));
        let enrollment = Arc::new(FakeEnrollment {
            result: EnrollmentResult::Failed,
            calls: AtomicUsize::new(0),
        });
        let state = state(vault, enrollment);

        for endpoint in [
            AuthenticatedEndpoint::Scores,
            AuthenticatedEndpoint::DailyStreakStates,
        ] {
            let request = state.request(endpoint).await.unwrap().build().unwrap();
            assert_eq!(request.method(), Method::GET);
            assert!(request.headers().contains_key(AUTHORIZATION));
            assert!(!request.headers().contains_key("x-torus-request-id"));
        }
        for endpoint in [
            AuthenticatedEndpoint::StartDailyAttempt,
            AuthenticatedEndpoint::ForfeitDailyAttempt,
            AuthenticatedEndpoint::RollbackDailyAttempt,
            AuthenticatedEndpoint::VerifyScore,
        ] {
            let request = state.request(endpoint).await.unwrap().build().unwrap();
            assert_eq!(request.method(), Method::POST);
            assert!(request.headers().contains_key(AUTHORIZATION));
            assert!(request.headers().contains_key("x-torus-timestamp"));
            assert!(request.headers().contains_key("x-torus-request-id"));
        }
    }

    #[tokio::test]
    async fn concurrent_calls_enroll_only_once() {
        let vault = Arc::new(MemoryVault::default());
        let enrollment = Arc::new(FakeEnrollment {
            result: EnrollmentResult::Enrolled,
            calls: AtomicUsize::new(0),
        });
        let state = Arc::new(state(vault, enrollment.clone()));
        let (a, b) = tokio::join!(state.ensure_enrolled(), state.ensure_enrolled());
        assert!(a.is_ok() && b.is_ok());
        assert_eq!(enrollment.calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn public_endpoint_policy_never_adds_authentication() {
        let vault = Arc::new(MemoryVault::default());
        let enrollment = Arc::new(FakeEnrollment {
            result: EnrollmentResult::Failed,
            calls: AtomicUsize::new(0),
        });
        let state = state(vault, enrollment);
        for endpoint in [PublicEndpoint::Scores, PublicEndpoint::DailyStreakStates] {
            let request = state.public_request(endpoint).build().unwrap();
            assert_eq!(request.method(), Method::GET);
            assert!(!request.headers().contains_key(AUTHORIZATION));
        }
    }
}
