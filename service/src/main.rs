#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use std::fs;
use std::collections::HashSet;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use axum::extract::{DefaultBodyLimit, Multipart, Path as AxumPath, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use base64::Engine;
use rand::distr::Alphanumeric;
use rand::{Rng, rng};
use reqwest::multipart::{Form, Part};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha1::{Digest, Sha1};
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

#[derive(Clone)]
struct AppState {
    config: Arc<AppConfig>,
}

#[derive(Debug)]
struct AppConfig {
    host: String,
    port: u16,
    data_dir: PathBuf,
    input_dir: PathBuf,
    output_dir: PathBuf,
    thumbnails_dir: PathBuf,
    app_config_file: PathBuf,
    canvas_file: PathBuf,
    deleted_canvas_file: PathBuf,
    db_file: PathBuf,
    settings_file: PathBuf,
    frontend_dist: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalAppConfig {
    app_name: String,
    logo_url: String,
    #[serde(default = "default_version")]
    version: String,
    theme_color: String,
    license_status: String,
    customer_id: String,
    machine_id: String,
    expires_at: Option<String>,
    last_sync_at: Option<String>,
    features: Vec<String>,
    update_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanvasListItem {
    id: String,
    name: String,
    node_count: usize,
    preview_url: String,
    preview_kind: String,
    created_at: u64,
    updated_at: u64,
}

#[derive(Debug, Deserialize)]
struct CreateCanvasBody {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RenameCanvasBody {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ThumbnailQuery {
    url: Option<String>,
    w: Option<u32>,
    h: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct DownloadBody {
    url: Option<String>,
    directory: Option<String>,
    #[serde(rename = "fileName")]
    file_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UploadBase64Body {
    #[serde(rename = "dataUrl")]
    data_url: Option<String>,
    prefix: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenPathBody {
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ImageSubmitBody {
    model: Option<String>,
    #[serde(rename = "apiModel")]
    api_model: Option<String>,
    #[serde(rename = "paramKind")]
    param_kind: Option<String>,
    prompt: Option<String>,
    n: Option<u32>,
    #[serde(default)]
    images: Vec<String>,
    image: Option<String>,
    aspect_ratio: Option<String>,
    image_size: Option<String>,
    size: Option<String>,
    quality: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ImageStatusQuery {
    model: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let config = Arc::new(AppConfig::from_env()?);
    config.ensure_dirs()?;
    init_database(&config)?;

    let state = AppState {
        config: config.clone(),
    };

    let app = Router::new()
        .route("/api/status", get(status))
        .route("/api/app/config", get(get_app_config))
        .route("/api/app/config/refresh", post(refresh_app_config))
        .route("/api/canvas", get(list_canvases).post(create_canvas))
        .route(
            "/api/canvas/{id}",
            get(get_canvas).put(save_canvas).delete(delete_canvas),
        )
        .route("/api/canvas/{id}/name", patch(rename_canvas))
        .route("/api/settings", get(get_settings).post(update_settings))
        .route("/api/proxy/image/submit", post(proxy_image_submit))
        .route("/api/proxy/image/status/{task_id}", get(proxy_image_status))
        .route("/api/files/upload", post(upload_file))
        .route("/api/files/upload-base64", post(upload_base64))
        .route("/api/files/list", get(list_output_files))
        .route("/api/files/thumbnail", get(thumbnail))
        .route("/api/files/download-to-directory", post(download_to_directory))
        .route("/api/files/cache-stats", get(cache_stats))
        .route("/api/files/cache-cleanup", post(cache_cleanup))
        .route("/api/files/open-download-directory", post(open_download_directory))
        .route("/api/files/open-path", post(open_path))
        .nest_service("/files/output", ServeDir::new(config.output_dir.clone()))
        .nest_service("/files/input", ServeDir::new(config.input_dir.clone()))
        .nest_service("/files/thumbnails", ServeDir::new(config.thumbnails_dir.clone()))
        .nest_service("/output", ServeDir::new(config.output_dir.clone()))
        .nest_service("/input", ServeDir::new(config.input_dir.clone()))
        .fallback(get(frontend_fallback))
        .layer(DefaultBodyLimit::max(200 * 1024 * 1024))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr: SocketAddr = format!("{}:{}", config.host, config.port).parse()?;
    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

impl AppConfig {
    fn from_env() -> Result<Self> {
        let project_dir = std::env::current_dir()
            .context("current_dir")?
            .parent()
            .map(Path::to_path_buf)
            .context("local process should run from its directory")?;
        let user_data = std::env::var("APP_DATA_DIR").ok().filter(|s| !s.trim().is_empty());
        let is_packaged = std::env::var("APP_PACKAGED").ok().as_deref() == Some("1");
        let base_dir = if is_packaged {
            user_data.map(PathBuf::from).unwrap_or(project_dir)
        } else {
            project_dir
        };
        let data_dir = base_dir.join("data");
        let input_dir = base_dir.join("input");
        let output_dir = base_dir.join("output");
        let thumbnails_dir = base_dir.join("thumbnails");
        let frontend_dist = std::env::var("APP_FRONTEND_DIR")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| base_dir.join("dist"));
        let port = std::env::var("PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(18766);
        Ok(Self {
            host: std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_owned()),
            port,
            app_config_file: data_dir.join("app_config.json"),
            canvas_file: data_dir.join("canvas_list.json"),
            deleted_canvas_file: data_dir.join("deleted_canvas_ids.json"),
            db_file: data_dir.join("app.db"),
            settings_file: data_dir.join("settings.json"),
            frontend_dist,
            data_dir,
            input_dir,
            output_dir,
            thumbnails_dir,
        })
    }

    fn ensure_dirs(&self) -> Result<()> {
        for dir in [&self.data_dir, &self.input_dir, &self.output_dir, &self.thumbnails_dir] {
            fs::create_dir_all(dir)?;
        }
        Ok(())
    }
}

fn init_database(config: &AppConfig) -> Result<()> {
    let conn = Connection::open(&config.db_file)?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS canvases (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            node_count INTEGER NOT NULL DEFAULT 0,
            preview_url TEXT NOT NULL DEFAULT '',
            preview_kind TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            deleted_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_canvases_visible_updated
            ON canvases(deleted_at, updated_at DESC);
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        "#,
    )?;

    let count: i64 = conn.query_row("SELECT COUNT(*) FROM canvases", [], |row| row.get(0))?;
    if count == 0 {
        let deleted = load_deleted_canvas_ids(config);
        let legacy: Vec<CanvasListItem> = fs::read_to_string(&config.canvas_file)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        for item in legacy.into_iter().filter(|item| !deleted.contains(&item.id)) {
            upsert_canvas_row(&conn, &item).map_err(|err| anyhow::anyhow!(err))?;
        }
    }
    migrate_settings_to_db(config, &conn)?;
    Ok(())
}

async fn frontend_fallback(
    State(state): State<AppState>,
    axum::extract::OriginalUri(uri): axum::extract::OriginalUri,
) -> Response {
    if uri.path().starts_with("/api/") {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "success": false, "error": "not found" })),
        )
            .into_response();
    }

    let rel = uri.path().trim_start_matches('/');
    let asset = if rel.is_empty() {
        state.config.frontend_dist.join("index.html")
    } else {
        state.config.frontend_dist.join(rel)
    };
    let target = if asset.exists() && asset.is_file() {
        asset
    } else {
        state.config.frontend_dist.join("index.html")
    };
    match tokio::fs::read(&target).await {
        Ok(bytes) => {
            let mime = mime_guess::from_path(&target).first_or_octet_stream();
            let mut headers = HeaderMap::new();
            headers.insert("content-type", HeaderValue::from_str(mime.as_ref()).unwrap());
            (headers, bytes).into_response()
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "success": false, "error": "frontend not built" })),
        )
            .into_response(),
    }
}

async fn status(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "ok": true,
        "runtime": "rust-service",
        "version": env!("CARGO_PKG_VERSION"),
        "port": state.config.port,
        "time": chrono::Utc::now().to_rfc3339(),
    }))
}

async fn get_app_config(State(state): State<AppState>) -> Json<Value> {
    Json(json!({ "success": true, "data": load_app_config(&state.config) }))
}

async fn refresh_app_config(State(state): State<AppState>) -> Json<Value> {
    let config = load_app_config(&state.config);
    Json(json!({
        "success": true,
        "data": config,
        "meta": {
            "synced": false,
            "message": "remote branding and license sync is reserved"
        }
    }))
}

async fn list_canvases(State(state): State<AppState>) -> Json<Value> {
    Json(json!({ "success": true, "data": load_canvas_list(&state.config) }))
}

async fn create_canvas(
    State(state): State<AppState>,
    Json(body): Json<CreateCanvasBody>,
) -> Result<Json<Value>, AppError> {
    let mut list = load_canvas_list(&state.config);
    let id = format!("canvas-{}-{}", now_ms(), random_suffix(6));
    let now = now_ms();
    let canvas = CanvasListItem {
        id: id.clone(),
        name: body.name.unwrap_or_else(|| "未命名画布".to_owned()),
        node_count: 0,
        preview_url: String::new(),
        preview_kind: String::new(),
        created_at: now,
        updated_at: now,
    };
    list.push(canvas.clone());
    save_canvas_list(&state.config, &list)?;
    write_json(
        canvas_path(&state.config, &id),
        &json!({ "nodes": [], "edges": [], "viewport": { "x": 0, "y": 0, "zoom": 1 } }),
    )?;
    Ok(Json(json!({ "success": true, "data": canvas })))
}

async fn get_canvas(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Value>, AppError> {
    if is_canvas_deleted(&state.config, &id) {
        return Err(AppError::not_found("画布不存在"));
    }
    let file = canvas_path(&state.config, &id);
    if !file.exists() {
        return Err(AppError::not_found("画布不存在"));
    }
    let data = read_json(file)?;
    Ok(Json(json!({ "success": true, "data": data })))
}

async fn save_canvas(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(incoming): Json<Value>,
) -> Result<Json<Value>, AppError> {
    if is_canvas_deleted(&state.config, &id) {
        return Err(AppError::not_found("画布不存在"));
    }
    let file = canvas_path(&state.config, &id);
    let incoming_nodes = incoming
        .get("nodes")
        .and_then(Value::as_array)
        .map(|arr| arr.len())
        .unwrap_or(0);
    if incoming_nodes == 0 && file.exists() {
        if let Ok(existing) = read_json(&file) {
            let existing_nodes = existing
                .get("nodes")
                .and_then(Value::as_array)
                .map(|arr| arr.len())
                .unwrap_or(0);
            if existing_nodes > 0 {
                return Err(AppError::bad_request("拒绝空数据覆盖"));
            }
        }
    }
    write_json(&file, &incoming)?;
    let mut list = load_canvas_list(&state.config);
    if let Some(item) = list.iter_mut().find(|item| item.id == id) {
        item.node_count = incoming_nodes;
        let (preview_url, preview_kind) = pick_preview(&incoming);
        item.preview_url = preview_url;
        item.preview_kind = preview_kind;
        item.updated_at = now_ms();
        save_canvas_list(&state.config, &list)?;
    }
    Ok(Json(json!({ "success": true })))
}

async fn delete_canvas(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Value>, AppError> {
    mark_canvas_deleted(&state.config, &id)?;
    let mut list = load_canvas_list(&state.config);
    list.retain(|item| item.id != id);
    save_canvas_list(&state.config, &list)?;
    let file = canvas_path(&state.config, &id);
    if file.exists() {
        let _ = fs::remove_file(file);
    }
    Ok(Json(json!({ "success": true })))
}

async fn rename_canvas(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<RenameCanvasBody>,
) -> Result<Json<Value>, AppError> {
    if is_canvas_deleted(&state.config, &id) {
        return Err(AppError::not_found("画布不存在"));
    }
    let mut list = load_canvas_list(&state.config);
    let Some(item) = list.iter_mut().find(|item| item.id == id) else {
        return Err(AppError::not_found("画布不存在"));
    };
    if let Some(name) = body.name.filter(|name| !name.trim().is_empty()) {
        item.name = name;
    }
    item.updated_at = now_ms();
    let cloned = item.clone();
    save_canvas_list(&state.config, &list)?;
    Ok(Json(json!({ "success": true, "data": cloned })))
}

async fn get_settings(State(state): State<AppState>) -> Json<Value> {
    let settings = load_settings(&state.config);
    Json(json!({ "success": true, "data": mask_settings(settings) }))
}

async fn update_settings(
    State(state): State<AppState>,
    Json(patch): Json<Value>,
) -> Result<Json<Value>, AppError> {
    let mut current = load_settings(&state.config);
    merge_json(&mut current, sanitize_settings_patch(patch));
    save_settings(&state.config, &current)?;
    Ok(Json(json!({ "success": true })))
}

async fn proxy_image_submit(
    State(state): State<AppState>,
    Json(body): Json<ImageSubmitBody>,
) -> Result<Json<Value>, AppError> {
    let prompt = body
        .prompt
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| AppError::bad_request("prompt 不得为空"))?;
    let model_hint = body.api_model.as_deref().or(body.model.as_deref()).unwrap_or("");
    let api_key = pick_image_api_key(&state.config, model_hint)
        .ok_or_else(|| AppError::bad_request("未配置图片生成 API Key"))?;
    let final_model = body
        .api_model
        .as_deref()
        .or(body.model.as_deref())
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| AppError::bad_request("model 必填"))?;
    let param_kind = body
        .param_kind
        .clone()
        .unwrap_or_else(|| if final_model.contains("nano-banana") { "banana-ratio".to_owned() } else { "gpt-size".to_owned() });
    let mut refs = body.images.clone();
    if let Some(image) = body.image.clone().filter(|v| !v.is_empty()) {
        if !refs.contains(&image) {
            refs.insert(0, image);
        }
    }
    reject_unsupported_image_request(&param_kind, final_model, body.image_size.as_deref(), &refs)?;

    let client = reqwest::Client::new();
    let upstream = call_image_upstream_async(&client, &state.config, &api_key, final_model, &param_kind, prompt, &body, &refs).await?;
    let status = upstream.status();
    let text = upstream.text().await.map_err(AppError::internal)?;
    let data: Value = serde_json::from_str(&text).map_err(|_| AppError::internal(format!("上游响应非 JSON: {}", text.chars().take(300).collect::<String>())))?;
    if !status.is_success() {
        return Err(AppError {
            status,
            message: upstream_error_message(&data, status),
        });
    }

    if let Some((urls, images)) = save_sync_images(&client, &state.config, &data).await? {
        return Ok(Json(json!({
            "success": true,
            "data": {
                "sync": true,
                "status": "completed",
                "progress": "100%",
                "urls": urls,
                "images": images,
                "raw": data
            }
        })));
    }

    if let Some(task_id) = extract_task_id(&data) {
        remember_image_task(&state.config, &task_id, &api_key)?;
        return Ok(Json(json!({
            "success": true,
            "data": {
                "sync": false,
                "taskId": task_id,
                "status": "pending",
                "progress": "0%",
                "raw": data
            }
        })));
    }

    Err(AppError::internal(format!(
        "上游未返回 task_id 且无同步图片: {}",
        serde_json::to_string(&data).unwrap_or_default().chars().take(300).collect::<String>()
    )))
}

async fn proxy_image_status(
    State(state): State<AppState>,
    AxumPath(task_id): AxumPath<String>,
    Query(query): Query<ImageStatusQuery>,
) -> Result<Json<Value>, AppError> {
    let api_key = recall_image_task_key(&state.config, &task_id)
        .or_else(|| pick_image_api_key(&state.config, query.model.as_deref().unwrap_or("")))
        .ok_or_else(|| AppError::bad_request("未配置图片生成 API Key"))?;
    let client = reqwest::Client::new();
    let base_url = image_base_url(&state.config);
    let url = format!("{base_url}/v1/images/tasks/{}", task_id);
    let upstream = client
        .get(url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(AppError::internal)?;
    let status_code = upstream.status();
    let text = upstream.text().await.map_err(AppError::internal)?;
    let data: Value = serde_json::from_str(&text).map_err(|_| AppError::internal(format!("上游响应非 JSON: {}", text.chars().take(300).collect::<String>())))?;
    if !status_code.is_success() {
        return Err(AppError {
            status: status_code,
            message: upstream_error_message(&data, status_code),
        });
    }

    let inner = data.get("data").unwrap_or(&Value::Null);
    let status = inner.get("status").and_then(Value::as_str).unwrap_or("pending").to_lowercase();
    let progress = inner.get("progress").and_then(Value::as_str).unwrap_or("0%");
    if matches!(status.as_str(), "success" | "completed" | "done") {
        if let Some((urls, images)) = save_task_images(&client, &state.config, inner).await? {
            forget_image_task(&state.config, &task_id);
            return Ok(Json(json!({
                "success": true,
                "data": {
                    "status": "completed",
                    "progress": "100%",
                    "urls": urls,
                    "images": images,
                    "raw": data
                }
            })));
        }
        return Err(AppError::internal("任务完成但未返回图片"));
    }
    if matches!(status.as_str(), "failure" | "failed" | "error") {
        forget_image_task(&state.config, &task_id);
        return Ok(Json(json!({
            "success": false,
            "data": {
                "status": "failed",
                "progress": progress,
                "error": image_task_error(inner).unwrap_or_else(|| "任务失败".to_owned()),
                "raw": data
            }
        })));
    }
    let queue = inner
        .get("data")
        .and_then(|v| v.get("status"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_lowercase();
    let normalized = if matches!(queue.as_str(), "in_progress" | "running") {
        "running"
    } else if matches!(queue.as_str(), "in_queue" | "queued") {
        "queued"
    } else {
        status.as_str()
    };
    Ok(Json(json!({
        "success": true,
        "data": {
            "status": normalized,
            "progress": if normalized == "running" && progress == "0%" { "10%" } else { progress },
            "raw": data
        }
    })))
}

async fn upload_file(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<Value>, AppError> {
    while let Some(field) = multipart.next_field().await.map_err(AppError::internal)? {
        if field.name() != Some("file") {
            continue;
        }
        let original = field.file_name().unwrap_or("upload.png").to_owned();
        let uploaded_mime = field.content_type().unwrap_or("application/octet-stream").to_owned();
        let bytes = field.bytes().await.map_err(AppError::internal)?;
        let original_ext = Path::new(&original)
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("png");
        let (mime, ext) = detect_image_bytes(&bytes)
            .map(|(mime, ext)| (mime.to_owned(), ext.to_owned()))
            .unwrap_or_else(|| (uploaded_mime, safe_ext(original_ext)));
        let filename = format!("up_{}_{}.{}", now_ms(), random_suffix(4), safe_ext(&ext));
        let path = state.config.input_dir.join(&filename);
        tokio::fs::write(&path, &bytes).await.map_err(AppError::internal)?;
        return Ok(Json(json!({
            "success": true,
            "data": {
                "filename": filename,
                "url": format!("/files/input/{filename}"),
                "size": bytes.len(),
                "mime": mime
            }
        })));
    }
    Err(AppError::bad_request("未收到文件"))
}

async fn upload_base64(
    State(state): State<AppState>,
    Json(body): Json<UploadBase64Body>,
) -> Result<Json<Value>, AppError> {
    let data_url = body.data_url.ok_or_else(|| AppError::bad_request("缺少 dataUrl"))?;
    let Some((header, b64)) = data_url.split_once(',') else {
        return Err(AppError::bad_request("dataUrl 格式不支持"));
    };
    if !header.starts_with("data:image/") {
        return Err(AppError::bad_request("dataUrl 格式不支持"));
    }
    let ext = if header.contains("webp") {
        "webp"
    } else if header.contains("jpeg") || header.contains("jpg") {
        "jpg"
    } else {
        "png"
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|_| AppError::bad_request("base64 解码失败"))?;
    let tag = body
        .prefix
        .unwrap_or_else(|| "draw".to_owned())
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(16)
        .collect::<String>();
    let tag = if tag.is_empty() { "draw".to_owned() } else { tag };
    let filename = format!("{}_{}_{}.{}", tag, now_ms(), random_suffix(4), ext);
    let path = state.config.output_dir.join(&filename);
    tokio::fs::write(&path, &bytes).await.map_err(AppError::internal)?;
    Ok(Json(json!({
        "success": true,
        "data": {
            "filename": filename,
            "url": format!("/files/output/{filename}"),
            "size": bytes.len()
        }
    })))
}

async fn list_output_files(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let mut files = Vec::new();
    for entry in fs::read_dir(&state.config.output_dir).map_err(AppError::internal)? {
        let entry = entry.map_err(AppError::internal)?;
        if !entry.file_type().map_err(AppError::internal)?.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_media_name(&name) {
            continue;
        }
        let meta = entry.metadata().map_err(AppError::internal)?;
        let mtime = meta
            .modified()
            .ok()
            .and_then(system_time_ms)
            .unwrap_or_default();
        files.push(json!({
            "filename": name,
            "url": format!("/files/output/{name}"),
            "size": meta.len(),
            "mtime": mtime
        }));
    }
    files.sort_by(|a, b| b["mtime"].as_u64().cmp(&a["mtime"].as_u64()));
    Ok(Json(json!({ "success": true, "data": files })))
}

async fn thumbnail(
    State(state): State<AppState>,
    Query(query): Query<ThumbnailQuery>,
) -> Result<Response, AppError> {
    let url = query.url.unwrap_or_default();
    let local = local_asset_path(&state.config, &url).ok_or_else(|| AppError::not_found("thumbnail source not found"))?;
    if !local.exists() {
        return Err(AppError::not_found("thumbnail source not found"));
    }
    let w = query.w.unwrap_or(320).clamp(80, 640);
    let h = query.h.unwrap_or(240).clamp(60, 640);
    let meta = fs::metadata(&local).map_err(AppError::internal)?;
    let modified = meta.modified().ok().and_then(system_time_ms).unwrap_or_default();
    let key = format!("{}:{}:{}:{}:{}", local.display(), meta.len(), modified, w, h);
    let mut hasher = Sha1::new();
    hasher.update(key.as_bytes());
    let filename = format!("{:x}.webp", hasher.finalize());
    let target = state.config.thumbnails_dir.join(filename);
    if !target.exists() {
        // Lightweight compatibility fallback: copy source. Real resizing can be added with image crate.
        fs::copy(&local, &target).map_err(AppError::internal)?;
    }
    let bytes = tokio::fs::read(&target).await.map_err(AppError::internal)?;
    let mime = mime_guess::from_path(&target).first_or_octet_stream();
    let mut headers = HeaderMap::new();
    headers.insert("content-type", HeaderValue::from_str(mime.as_ref()).unwrap());
    headers.insert("cache-control", HeaderValue::from_static("public, max-age=31536000, immutable"));
    Ok((headers, bytes).into_response())
}

async fn download_to_directory(
    State(state): State<AppState>,
    Json(body): Json<DownloadBody>,
) -> Result<Json<Value>, AppError> {
    let target_dir = body
        .directory
        .filter(|v| !v.trim().is_empty())
        .or_else(|| configured_download_dir(&state.config))
        .or_else(default_download_dir)
        .ok_or_else(|| AppError::bad_request("download directory is not configured"))?;
    let url = body.url.ok_or_else(|| AppError::bad_request("missing url"))?;
    fs::create_dir_all(&target_dir).map_err(AppError::internal)?;
    let file_name = infer_file_name(&url, body.file_name.as_deref());
    let target = unique_target_path(Path::new(&target_dir), &file_name);
    if url.starts_with("data:") {
        let Some((_, b64)) = url.split_once(',') else {
            return Err(AppError::bad_request("unsupported data url"));
        };
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|_| AppError::bad_request("unsupported data url"))?;
        fs::write(&target, bytes).map_err(AppError::internal)?;
    } else if let Some(local) = local_asset_path(&state.config, &url) {
        fs::copy(local, &target).map_err(AppError::internal)?;
    } else if url.starts_with("http://") || url.starts_with("https://") {
        let resp = reqwest::get(&url).await.map_err(AppError::internal)?;
        if !resp.status().is_success() {
            return Err(AppError::bad_request(format!("remote download failed: {}", resp.status())));
        }
        let bytes = resp.bytes().await.map_err(AppError::internal)?;
        if bytes.is_empty() {
            return Err(AppError::bad_request("remote file is empty"));
        }
        fs::write(&target, bytes).map_err(AppError::internal)?;
    } else {
        return Err(AppError::bad_request("unsupported download url"));
    }
    let file_name = target.file_name().and_then(|v| v.to_str()).unwrap_or("").to_owned();
    Ok(Json(json!({
        "success": true,
        "data": { "path": target, "directory": target_dir, "fileName": file_name }
    })))
}

async fn cache_stats(State(state): State<AppState>) -> Json<Value> {
    Json(json!({ "success": true, "data": cache_summary(&state.config) }))
}

async fn cache_cleanup(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "success": true,
        "data": { "removedFiles": 0, "removedSize": 0, "summary": cache_summary(&state.config) }
    }))
}

async fn open_download_directory(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let dir = configured_download_dir(&state.config)
        .or_else(default_download_dir)
        .ok_or_else(|| AppError::bad_request("download directory is not configured"))?;
    if !Path::new(&dir).exists() {
        return Err(AppError::not_found("download directory does not exist"));
    }
    open_with_explorer(&dir);
    Ok(Json(json!({ "success": true, "data": { "directory": dir } })))
}

async fn open_path(Json(body): Json<OpenPathBody>) -> Result<Json<Value>, AppError> {
    let path = body.path.ok_or_else(|| AppError::bad_request("path is not configured"))?;
    if !Path::new(&path).exists() {
        return Err(AppError::not_found("path does not exist"));
    }
    open_with_explorer(&path);
    Ok(Json(json!({ "success": true, "data": { "path": path } })))
}

async fn call_image_upstream_async(
    client: &reqwest::Client,
    config: &AppConfig,
    api_key: &str,
    final_model: &str,
    param_kind: &str,
    prompt: &str,
    body: &ImageSubmitBody,
    refs: &[String],
) -> Result<reqwest::Response, AppError> {
    let aspect = body.aspect_ratio.as_deref().unwrap_or("1:1");
    let image_size = body.image_size.as_deref().unwrap_or("2K");
    let size = body
        .size
        .clone()
        .unwrap_or_else(|| aspect_to_required_gpt_size(aspect, image_size));
    let n = body.n.unwrap_or(1).clamp(1, 10);
    let quality = body.quality.as_deref().unwrap_or("auto");
    let resolved_model = resolve_standard_image_model(final_model, image_size);
    let base_url = image_base_url(config);
    let aspect_normalized = normalize_aspect(aspect);
    let aspect_ratio_field = if aspect.eq_ignore_ascii_case("auto") {
        String::new()
    } else {
        aspect_normalized.clone()
    };
    let image_size_upper = image_size.to_uppercase();
    let image_size_lower = image_size.to_lowercase();

    if param_kind == "gpt-size" && !refs.is_empty() {
        let mut form = Form::new()
            .text("prompt", prompt.to_owned())
            .text("model", resolved_model)
            .text("n", n.to_string())
            .text("quality", quality.to_owned())
            .text("moderation", "auto".to_owned())
            .text("size", size.clone())
            .text("image_size", image_size_upper.clone())
            .text("aspect_ratio", aspect_normalized.clone())
            .text("aspectRatio", aspect_ratio_field.clone())
            .text("resolution", image_size_lower.clone())
            .text("resolution_label", image_size_upper.clone());
        for (idx, item) in refs.iter().enumerate() {
            if let Some(part) = ref_to_part(client, config, item, idx).await? {
                form = form.part("image", part);
            }
        }
        return client
            .post(format!("{base_url}/v1/images/edits?async=true"))
            .bearer_auth(api_key)
            .multipart(form)
            .send()
            .await
            .map_err(AppError::internal);
    }

    if param_kind == "gpt-size" {
        let payload = json!({
            "prompt": prompt,
            "model": resolved_model,
            "n": n,
            "quality": quality,
            "moderation": "auto",
            "size": size,
            "image_size": image_size_upper,
            "aspect_ratio": aspect_normalized,
            "aspectRatio": aspect_ratio_field,
            "resolution": image_size_lower,
            "resolution_label": image_size.to_uppercase(),
        });
        return client
            .post(format!("{base_url}/v1/images/generations?async=true"))
            .bearer_auth(api_key)
            .json(&payload)
            .send()
            .await
            .map_err(AppError::internal);
    }

    if !refs.is_empty() {
        let mut form = Form::new()
            .text("prompt", prompt.to_owned())
            .text("model", resolved_model.clone())
            .text("aspect_ratio", aspect_normalized.clone());
        if resolved_model.contains("nano-banana") {
            form = form.text("image_size", image_size_upper.clone());
        }
        for (idx, item) in refs.iter().enumerate() {
            if let Some(part) = ref_to_part(client, config, item, idx).await? {
                form = form.part("image", part);
            }
        }
        return client
            .post(format!("{base_url}/v1/images/edits?async=true"))
            .bearer_auth(api_key)
            .multipart(form)
            .send()
            .await
            .map_err(AppError::internal);
    }

    let mut payload = json!({
        "prompt": prompt,
        "model": resolved_model,
        "aspect_ratio": aspect_normalized,
    });
    if final_model.contains("nano-banana") {
        payload["image_size"] = json!(image_size_upper);
    }
    client
        .post(format!("{base_url}/v1/images/generations?async=true"))
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await
        .map_err(AppError::internal)
}

async fn ref_to_part(
    client: &reqwest::Client,
    config: &AppConfig,
    value: &str,
    index: usize,
) -> Result<Option<Part>, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let (bytes, _mime, _ext) = if trimmed.starts_with("data:") {
        let Some((header, b64)) = trimmed.split_once(',') else {
            return Err(AppError::bad_request(format!(
                "Reference image #{} has an invalid data URL",
                index + 1
            )));
        };
        let mime = header
            .strip_prefix("data:")
            .and_then(|v| v.split_once(';').map(|(m, _)| m))
            .unwrap_or("image/png")
            .to_owned();
        let ext = mime_ext(&mime);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|_| AppError::bad_request("参考图 base64 解码失败"))?;
        (bytes, mime, ext)
    } else if let Some(local) = local_asset_path(config, trimmed) {
        let bytes = tokio::fs::read(&local).await.map_err(AppError::internal)?;
        let mime = mime_guess::from_path(&local).first_or_octet_stream().to_string();
        let ext = local
            .extension()
            .and_then(|v| v.to_str())
            .map(safe_ext)
            .unwrap_or_else(|| mime_ext(&mime));
        (bytes, mime, ext)
    } else if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        let resp = client.get(trimmed).send().await.map_err(AppError::internal)?;
        if !resp.status().is_success() {
            return Err(AppError::internal(format!("参考图下载失败: {}", resp.status())));
        }
        let mime = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("image/png")
            .to_owned();
        let ext = mime_ext(&mime);
        let bytes = resp.bytes().await.map_err(AppError::internal)?.to_vec();
        (bytes, mime, ext)
    } else {
        return Err(AppError::bad_request(format!(
            "Reference image #{} uses an unsupported URL. Please upload it again.",
            index + 1
        )));
    };
    let Some((detected_mime, detected_ext)) = detect_image_bytes(&bytes) else {
        return Err(AppError::bad_request(format!(
            "第{}张参考图不是有效图片，请删除后重新上传",
            index + 1
        )));
    };
    let part = Part::bytes(bytes)
        .file_name(format!("image_{index}.{detected_ext}"))
        .mime_str(detected_mime)
        .map_err(AppError::internal)?;
    Ok(Some(part))
}

async fn save_sync_images(
    client: &reqwest::Client,
    config: &AppConfig,
    data: &Value,
) -> Result<Option<(Vec<String>, Vec<Value>)>, AppError> {
    let Some(items) = data.get("data").and_then(Value::as_array) else {
        return Ok(None);
    };
    save_image_items(client, config, items).await
}

async fn save_task_images(
    client: &reqwest::Client,
    config: &AppConfig,
    inner: &Value,
) -> Result<Option<(Vec<String>, Vec<Value>)>, AppError> {
    let data = inner.get("data").unwrap_or(&Value::Null);
    if let Some(items) = data.get("data").and_then(Value::as_array) {
        return save_image_items(client, config, items).await;
    }
    if let Some(items) = data.as_array() {
        return save_image_items(client, config, items).await;
    }
    Ok(None)
}

async fn save_image_items(
    client: &reqwest::Client,
    config: &AppConfig,
    items: &[Value],
) -> Result<Option<(Vec<String>, Vec<Value>)>, AppError> {
    let mut urls = Vec::new();
    let mut images = Vec::new();
    for item in items {
        let saved = if let Some(b64) = item
            .get("b64_json")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|_| AppError::internal("上游图片 base64 解码失败"))?;
            save_output_bytes(config, bytes, "png").await?
        } else if let Some(url) = item
            .get("url")
            .and_then(Value::as_str)
            .or_else(|| item.get("image_url").and_then(Value::as_str))
            .or_else(|| item.get("imageUrl").and_then(Value::as_str))
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            let resp = client.get(url).send().await.map_err(AppError::internal)?;
            if !resp.status().is_success() {
                continue;
            }
            let ext = url
                .rsplit('.')
                .next()
                .map(|v| safe_ext(v.split('?').next().unwrap_or(v)))
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| "png".to_owned());
            let bytes = resp.bytes().await.map_err(AppError::internal)?.to_vec();
            save_output_bytes(config, bytes, &ext).await?
        } else {
            continue;
        };
        urls.push(saved.clone());
        images.push(json!({ "url": saved }));
    }
    if urls.is_empty() {
        Ok(None)
    } else {
        Ok(Some((urls, images)))
    }
}

async fn save_output_bytes(config: &AppConfig, bytes: Vec<u8>, ext: &str) -> Result<String, AppError> {
    if bytes.is_empty() {
        return Err(AppError::internal("上游返回了空图片数据"));
    }
    let filename = format!("img_{}_{}.{}", now_ms(), random_suffix(4), safe_ext(ext));
    let path = config.output_dir.join(&filename);
    tokio::fs::write(&path, bytes).await.map_err(AppError::internal)?;
    Ok(format!("/files/output/{filename}"))
}

fn pick_image_api_key(config: &AppConfig, hint: &str) -> Option<String> {
    let settings = load_settings(config);
    let fallback = settings.get("zhenzhenApiKey").and_then(Value::as_str).unwrap_or("").trim();
    let hint = hint.to_lowercase();
    let gpt_key = settings.get("gptImageApiKey").and_then(Value::as_str).unwrap_or("").trim();
    let banana_key = settings.get("nanoBananaApiKey").and_then(Value::as_str).unwrap_or("").trim();
    let specific = if is_gpt_image_hint(&hint) {
        gpt_key
    } else if is_banana_hint(&hint) {
        banana_key
    } else {
        ""
    };
    let key = if !specific.is_empty() {
        specific
    } else if !fallback.is_empty() {
        fallback
    } else if !gpt_key.is_empty() && banana_key.is_empty() {
        gpt_key
    } else if !banana_key.is_empty() && gpt_key.is_empty() {
        banana_key
    } else {
        ""
    };
    if key.is_empty() {
        None
    } else {
        Some(key.to_owned())
    }
}

fn is_gpt_image_hint(hint: &str) -> bool {
    let compact = hint
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>();
    hint.contains("gpt-image") || hint.contains("gpt_image") || compact.contains("gptimage")
}

fn is_banana_hint(hint: &str) -> bool {
    let compact = hint
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>();
    hint.contains("nano-banana") || hint.contains("nano_banana") || compact.contains("nanobanana")
}

fn extract_task_id(data: &Value) -> Option<String> {
    data.get("data")
        .and_then(Value::as_str)
        .or_else(|| data.get("task_id").and_then(Value::as_str))
        .or_else(|| data.get("id").and_then(Value::as_str))
        .or_else(|| data.get("data").and_then(|v| v.get("task_id")).and_then(Value::as_str))
        .map(ToOwned::to_owned)
}

fn upstream_error_message(data: &Value, status: StatusCode) -> String {
    data.get("error")
        .and_then(|v| v.get("message").or(Some(v)))
        .and_then(Value::as_str)
        .or_else(|| data.get("message").and_then(Value::as_str))
        .or_else(|| data.get("detail").and_then(Value::as_str))
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("上游 HTTP {status}"))
}

fn image_task_file(config: &AppConfig) -> PathBuf {
    config.data_dir.join("image_task_keys.json")
}

fn image_base_url(config: &AppConfig) -> String {
    let env_url = std::env::var("IMADE_PROVIDER_BASE_URL")
        .or_else(|_| std::env::var("IMADE_IMAGE_BASE_URL"))
        .ok()
        .unwrap_or_default();
    if !env_url.trim().is_empty() {
        return normalize_base_url(&env_url);
    }

    let settings = load_settings(config);
    let configured = settings
        .get("zhenzhenBaseUrl")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !configured.trim().is_empty() {
        return normalize_base_url(configured);
    }

    "https://ai.comfly.org".to_owned()
}

fn normalize_base_url(value: &str) -> String {
    value
        .trim()
        .trim_end_matches('/')
        .trim_end_matches("/v1")
        .trim_end_matches('/')
        .to_owned()
}

fn image_task_error(inner: &Value) -> Option<String> {
    for key in ["fail_reason", "failReason", "error", "message", "detail"] {
        if let Some(value) = inner.get(key).and_then(Value::as_str) {
            let message = value.trim();
            if !message.is_empty() {
                return Some(message.to_owned());
            }
        }
    }

    if let Some(nested) = inner.get("data") {
        for key in ["fail_reason", "failReason", "error", "message", "detail"] {
            if let Some(value) = nested.get(key).and_then(Value::as_str) {
                let message = value.trim();
                if !message.is_empty() {
                    return Some(message.to_owned());
                }
            }
        }
    }

    None
}

fn remember_image_task(config: &AppConfig, task_id: &str, api_key: &str) -> Result<(), AppError> {
    let path = image_task_file(config);
    let mut map = read_json(&path).unwrap_or_else(|_| json!({}));
    map[task_id] = json!(api_key);
    write_json(path, &map)
}

fn recall_image_task_key(config: &AppConfig, task_id: &str) -> Option<String> {
    read_json(image_task_file(config))
        .ok()
        .and_then(|v| v.get(task_id).and_then(Value::as_str).map(ToOwned::to_owned))
}

fn forget_image_task(config: &AppConfig, task_id: &str) {
    let path = image_task_file(config);
    let Ok(mut map) = read_json(&path) else {
        return;
    };
    if let Some(obj) = map.as_object_mut() {
        obj.remove(task_id);
        let _ = write_json(path, &map);
    }
}

fn resolve_standard_image_model(model: &str, size_level: &str) -> String {
    let level = size_level.to_uppercase();
    if model == "gpt-image-2-all-fal" {
        "gpt-image-2".to_owned()
    } else if model == "nano-banana-pro" && (level == "2K" || level == "4K") {
        format!("nano-banana-pro-{}", level.to_lowercase())
    } else {
        model.to_owned()
    }
}

fn normalize_aspect(aspect: &str) -> String {
    let trimmed = aspect.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("auto") || trimmed == "empty" {
        "1:1".to_owned()
    } else {
        trimmed.to_owned()
    }
}

fn reject_unsupported_image_request(
    param_kind: &str,
    model: &str,
    image_size: Option<&str>,
    refs: &[String],
) -> Result<(), AppError> {
    let is_gpt_standard = param_kind == "gpt-size" && model.contains("gpt-image-2") && !model.contains("-fal");
    let size = image_size.unwrap_or("2K").trim().to_uppercase();
    if is_gpt_standard && !refs.is_empty() && size == "4K" {
        return Err(AppError::bad_request(
            "gpt-image-2 带参考图编辑时暂不提交 4K，容易被上游扣费后返回失败。请切换到 2K 后再生成。",
        ));
    }
    Ok(())
}

fn aspect_to_required_gpt_size(aspect: &str, size_level: &str) -> String {
    let aspect = normalize_aspect(aspect);
    let level = size_level.to_lowercase();
    match (aspect.as_str(), level.as_str()) {
        ("1:1", "1k") => "1024x1024",
        ("1:1", "2k") => "2048x2048",
        ("1:1", "4k") => "2880x2880",
        ("3:2", "1k") => "1248x832",
        ("3:2", "2k") => "2496x1664",
        ("3:2", "4k") => "3504x2336",
        ("2:3", "1k") => "832x1248",
        ("2:3", "2k") => "1664x2496",
        ("2:3", "4k") => "2336x3504",
        ("4:3", "1k") => "1152x864",
        ("4:3", "2k") => "2304x1728",
        ("4:3", "4k") => "3264x2448",
        ("3:4", "1k") => "864x1152",
        ("3:4", "2k") => "1728x2304",
        ("3:4", "4k") => "2448x3264",
        ("16:9", "1k") => "1280x720",
        ("16:9", "2k") => "2560x1440",
        ("16:9", "4k") => "3840x2160",
        ("9:16", "1k") => "720x1280",
        ("9:16", "2k") => "1440x2560",
        ("9:16", "4k") => "2160x3840",
        _ => "1024x1024",
    }
    .to_owned()
}

fn mime_ext(mime: &str) -> String {
    if mime.contains("jpeg") || mime.contains("jpg") {
        "jpg"
    } else if mime.contains("webp") {
        "webp"
    } else if mime.contains("gif") {
        "gif"
    } else {
        "png"
    }
    .to_owned()
}

fn load_canvas_list(config: &AppConfig) -> Vec<CanvasListItem> {
    let Ok(conn) = Connection::open(&config.db_file) else {
        return Vec::new();
    };
    let Ok(mut stmt) = conn.prepare(
        r#"
        SELECT id, name, node_count, preview_url, preview_kind, created_at, updated_at
        FROM canvases
        WHERE deleted_at IS NULL
        ORDER BY updated_at DESC
        "#,
    ) else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map([], |row| {
        Ok(CanvasListItem {
            id: row.get(0)?,
            name: row.get(1)?,
            node_count: row.get::<_, i64>(2)?.max(0) as usize,
            preview_url: row.get(3)?,
            preview_kind: row.get(4)?,
            created_at: row.get::<_, i64>(5)?.max(0) as u64,
            updated_at: row.get::<_, i64>(6)?.max(0) as u64,
        })
    }) else {
        return Vec::new();
    };
    rows.filter_map(Result::ok).collect()
}

fn save_canvas_list(config: &AppConfig, list: &[CanvasListItem]) -> Result<(), AppError> {
    let conn = Connection::open(&config.db_file).map_err(AppError::internal)?;
    let deleted = load_deleted_canvas_ids(config);
    let filtered: Vec<CanvasListItem> = list
        .iter()
        .filter(|item| !deleted.contains(&item.id))
        .cloned()
        .collect();
    for item in &filtered {
        if is_canvas_deleted(config, &item.id) {
            continue;
        }
        upsert_canvas_row(&conn, item).map_err(AppError::internal)?;
    }
    write_json(&config.canvas_file, &filtered)
}

fn canvas_path(config: &AppConfig, id: &str) -> PathBuf {
    config.data_dir.join(format!("canvas_{}.json", safe_id(id)))
}

fn load_deleted_canvas_ids(config: &AppConfig) -> HashSet<String> {
    fs::read_to_string(&config.deleted_canvas_file)
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
        .unwrap_or_default()
        .into_iter()
        .collect()
}

fn is_canvas_deleted(config: &AppConfig, id: &str) -> bool {
    if load_deleted_canvas_ids(config).contains(id) {
        return true;
    }
    let Ok(conn) = Connection::open(&config.db_file) else {
        return false;
    };
    conn.query_row(
        "SELECT deleted_at IS NOT NULL FROM canvases WHERE id = ?1",
        params![id],
        |row| row.get::<_, bool>(0),
    )
    .unwrap_or(false)
}

fn mark_canvas_deleted(config: &AppConfig, id: &str) -> Result<(), AppError> {
    let mut deleted = load_deleted_canvas_ids(config);
    deleted.insert(id.to_owned());
    let mut list: Vec<String> = deleted.into_iter().collect();
    list.sort();
    write_json(&config.deleted_canvas_file, &list)?;

    let conn = Connection::open(&config.db_file).map_err(AppError::internal)?;
    let now = now_ms() as i64;
    let changed = conn
        .execute(
            "UPDATE canvases SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
            params![id, now],
        )
        .map_err(AppError::internal)?;
    if changed == 0 {
        conn.execute(
            r#"
            INSERT INTO canvases
                (id, name, node_count, preview_url, preview_kind, created_at, updated_at, deleted_at)
            VALUES (?1, '', 0, '', '', ?2, ?2, ?2)
            "#,
            params![id, now],
        )
        .map_err(AppError::internal)?;
    }
    Ok(())
}

fn upsert_canvas_row(conn: &Connection, item: &CanvasListItem) -> rusqlite::Result<()> {
    conn.execute(
        r#"
        INSERT INTO canvases
            (id, name, node_count, preview_url, preview_kind, created_at, updated_at, deleted_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            node_count = excluded.node_count,
            preview_url = excluded.preview_url,
            preview_kind = excluded.preview_kind,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
        WHERE canvases.deleted_at IS NULL
        "#,
        params![
            item.id,
            item.name,
            item.node_count as i64,
            item.preview_url,
            item.preview_kind,
            item.created_at as i64,
            item.updated_at as i64,
        ],
    )?;
    Ok(())
}

fn read_json(path: impl AsRef<Path>) -> Result<Value, AppError> {
    let text = fs::read_to_string(path).map_err(AppError::internal)?;
    serde_json::from_str(&text).map_err(AppError::internal)
}

fn write_json(path: impl AsRef<Path>, value: &impl Serialize) -> Result<(), AppError> {
    if let Some(parent) = path.as_ref().parent() {
        fs::create_dir_all(parent).map_err(AppError::internal)?;
    }
    let text = serde_json::to_string_pretty(value).map_err(AppError::internal)?;
    fs::write(path, text).map_err(AppError::internal)
}

fn pick_preview(data: &Value) -> (String, String) {
    let Some(nodes) = data.get("nodes").and_then(Value::as_array) else {
        return (String::new(), String::new());
    };
    for node in nodes {
        let d = node.get("data").unwrap_or(&Value::Null);
        if let Some(url) = d.get("imageUrl").and_then(Value::as_str) {
            if !url.is_empty() {
                return (url.to_owned(), "image".to_owned());
            }
        }
        if let Some(url) = d
            .get("imageUrls")
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
            .and_then(Value::as_str)
        {
            if !url.is_empty() {
                return (url.to_owned(), "image".to_owned());
            }
        }
        if let Some(url) = d.get("videoUrl").and_then(Value::as_str) {
            if !url.is_empty() {
                return (url.to_owned(), "video".to_owned());
            }
        }
    }
    (String::new(), String::new())
}

fn default_settings() -> Value {
    json!({
        "zhenzhenApiKey": "",
        "zhenzhenBaseUrl": "https://ai.comfly.org",
        "rhApiKey": "",
        "rhBaseUrl": "https://www.runninghub.cn",
        "rhWalletApiKey": "",
        "llmApiKey": "",
        "llmBaseUrl": "https://ai.comfly.org",
        "gptImageApiKey": "",
        "nanoBananaApiKey": "",
        "mjApiKey": "",
        "veoApiKey": "",
        "grokApiKey": "",
        "seedanceApiKey": "",
        "sunoApiKey": "",
        "sharedFolderPath": "",
        "netdiskUrl": "",
        "downloadDir": "",
        "preferences": { "theme": "dark", "language": "zh-CN" }
    })
}

fn migrate_settings_to_db(config: &AppConfig, conn: &Connection) -> Result<()> {
    let existing: i64 = conn.query_row(
        "SELECT COUNT(*) FROM settings WHERE key = 'app_settings'",
        [],
        |row| row.get(0),
    )?;
    if existing > 0 {
        return Ok(());
    }
    if let Ok(legacy) = read_json(&config.settings_file) {
        let mut settings = default_settings();
        merge_json(&mut settings, legacy);
        let text = serde_json::to_string_pretty(&settings)?;
        conn.execute(
            r#"
            INSERT OR REPLACE INTO settings (key, value, updated_at)
            VALUES ('app_settings', ?1, ?2)
            "#,
            params![text, now_ms() as i64],
        )?;
    }
    Ok(())
}

fn load_settings_from_db(config: &AppConfig) -> Option<Value> {
    let conn = Connection::open(&config.db_file).ok()?;
    let text: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'app_settings'",
            [],
            |row| row.get(0),
        )
        .optional()
        .ok()?;
    text.and_then(|text| serde_json::from_str(&text).ok())
}

fn save_settings(config: &AppConfig, settings: &Value) -> Result<(), AppError> {
    let conn = Connection::open(&config.db_file).map_err(AppError::internal)?;
    let text = serde_json::to_string_pretty(settings).map_err(AppError::internal)?;
    conn.execute(
        r#"
        INSERT INTO settings (key, value, updated_at)
        VALUES ('app_settings', ?1, ?2)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        "#,
        params![text, now_ms() as i64],
    )
    .map_err(AppError::internal)?;
    write_json(&config.settings_file, settings)
}

fn load_settings(config: &AppConfig) -> Value {
    let mut defaults = json!({
        "zhenzhenApiKey": "",
        "zhenzhenBaseUrl": "https://ai.comfly.org",
        "rhApiKey": "",
        "rhBaseUrl": "https://www.runninghub.cn",
        "rhWalletApiKey": "",
        "llmApiKey": "",
        "llmBaseUrl": "https://ai.comfly.org",
        "gptImageApiKey": "",
        "nanoBananaApiKey": "",
        "mjApiKey": "",
        "veoApiKey": "",
        "grokApiKey": "",
        "seedanceApiKey": "",
        "sunoApiKey": "",
        "sharedFolderPath": "",
        "netdiskUrl": "",
        "downloadDir": "",
        "preferences": { "theme": "dark", "language": "zh-CN" }
    });
    if let Some(existing) = load_settings_from_db(config) {
        merge_json(&mut defaults, existing);
    } else if let Ok(existing) = read_json(&config.settings_file) {
        merge_json(&mut defaults, existing);
    }
    defaults
}

fn sanitize_settings_patch(mut patch: Value) -> Value {
    const KEY_FIELDS: [&str; 9] = [
        "zhenzhenApiKey",
        "llmApiKey",
        "gptImageApiKey",
        "nanoBananaApiKey",
        "mjApiKey",
        "veoApiKey",
        "grokApiKey",
        "seedanceApiKey",
        "sunoApiKey",
    ];
    if let Some(obj) = patch.as_object_mut() {
        for field in KEY_FIELDS {
            let should_remove = obj
                .get(field)
                .and_then(Value::as_str)
                .map(|value| {
                    let trimmed = value.trim();
                    trimmed.is_empty() || trimmed.starts_with("****")
                })
                .unwrap_or(false);
            if should_remove {
                obj.remove(field);
            }
        }
    }
    patch
}

fn load_app_config(config: &AppConfig) -> LocalAppConfig {
    let mut current = default_app_config(config);
    if let Ok(existing) = read_json(&config.app_config_file) {
        if let Ok(loaded) = serde_json::from_value::<LocalAppConfig>(existing) {
            current = loaded;
        }
    }
    current
}

fn default_app_config(config: &AppConfig) -> LocalAppConfig {
    LocalAppConfig {
        app_name: "iMade".to_owned(),
        logo_url: "/logo.svg".to_owned(),
        version: default_version(),
        theme_color: "#d7ccb3".to_owned(),
        license_status: "offline".to_owned(),
        customer_id: "local-default".to_owned(),
        machine_id: machine_id(config),
        expires_at: None,
        last_sync_at: None,
        features: vec![
            "canvas".to_owned(),
            "image-generation".to_owned(),
            "reference-image".to_owned(),
            "workflow".to_owned(),
            "white-label".to_owned(),
        ],
        update_url: String::new(),
    }
}

fn default_version() -> String {
    std::env::var("IMADE_APP_VERSION").unwrap_or_else(|_| "1.0.0".to_owned())
}

fn machine_id(config: &AppConfig) -> String {
    let mut hasher = Sha1::new();
    hasher.update(config.data_dir.to_string_lossy().as_bytes());
    format!("{:x}", hasher.finalize())[..16].to_owned()
}

fn mask_settings(mut settings: Value) -> Value {
    for key in [
        "zhenzhenApiKey",
        "rhApiKey",
        "rhWalletApiKey",
        "llmApiKey",
        "gptImageApiKey",
        "nanoBananaApiKey",
        "mjApiKey",
        "veoApiKey",
        "grokApiKey",
        "seedanceApiKey",
        "sunoApiKey",
    ] {
        if let Some(value) = settings.get_mut(key) {
            if let Some(s) = value.as_str() {
                *value = json!(mask_key(s));
            }
        }
    }
    settings
}

fn merge_json(base: &mut Value, patch: Value) {
    match (base, patch) {
        (Value::Object(base), Value::Object(patch)) => {
            for (key, value) in patch {
                if value.as_str().map(|s| s.starts_with("**")).unwrap_or(false) {
                    continue;
                }
                merge_json(base.entry(key).or_insert(Value::Null), value);
            }
        }
        (base, patch) => *base = patch,
    }
}

fn mask_key(value: &str) -> String {
    if value.is_empty() {
        String::new()
    } else {
        let suffix = value.chars().rev().take(4).collect::<String>();
        format!("****{}", suffix.chars().rev().collect::<String>())
    }
}

fn local_asset_path(config: &AppConfig, url: &str) -> Option<PathBuf> {
    let decoded = percent_decode(url.split('?').next().unwrap_or(url));
    let roots = [
        ("/files/output/", &config.output_dir),
        ("/output/", &config.output_dir),
        ("/files/input/", &config.input_dir),
        ("/input/", &config.input_dir),
        ("/files/thumbnails/", &config.thumbnails_dir),
    ];
    for (prefix, dir) in roots {
        if let Some(rel) = decoded.strip_prefix(prefix) {
            let full = dir.join(rel);
            if full.starts_with(dir) {
                return Some(full);
            }
        }
    }
    None
}

fn cache_summary(config: &AppConfig) -> Value {
    let output = dir_summary(&config.output_dir);
    let input = dir_summary(&config.input_dir);
    let thumbnails = dir_summary(&config.thumbnails_dir);
    let total_size = output.1 + input.1 + thumbnails.1;
    let total_files = output.0 + input.0 + thumbnails.0;
    json!({
        "totalSize": total_size,
        "totalFiles": total_files,
        "byDir": {
            "output": { "path": config.output_dir, "files": output.0, "size": output.1 },
            "input": { "path": config.input_dir, "files": input.0, "size": input.1 },
            "thumbnails": { "path": config.thumbnails_dir, "files": thumbnails.0, "size": thumbnails.1 }
        }
    })
}

fn dir_summary(dir: &Path) -> (usize, u64) {
    let mut files = 0;
    let mut size = 0;
    if let Ok(read) = fs::read_dir(dir) {
        for entry in read.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    files += 1;
                    size += meta.len();
                }
            }
        }
    }
    (files, size)
}

fn configured_download_dir(config: &AppConfig) -> Option<String> {
    load_settings(config)
        .get("downloadDir")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

fn default_download_dir() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            let dir = PathBuf::from(profile).join("Downloads");
            return Some(dir.to_string_lossy().into_owned());
        }
    }
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join("Downloads").to_string_lossy().into_owned())
}

fn infer_file_name(url: &str, fallback: Option<&str>) -> String {
    if let Some(name) = fallback.filter(|v| !v.trim().is_empty()) {
        return safe_file_name(name);
    }
    let base = url
        .split('?')
        .next()
        .unwrap_or(url)
        .rsplit('/')
        .next()
        .unwrap_or("");
    if !base.is_empty() {
        safe_file_name(base)
    } else {
        format!("download-{}", now_ms())
    }
}

fn unique_target_path(dir: &Path, file_name: &str) -> PathBuf {
    let mut target = dir.join(file_name);
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("download");
    let ext = Path::new(file_name)
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| format!(".{}", v))
        .unwrap_or_default();
    let mut i = 1;
    while target.exists() {
        target = dir.join(format!("{stem}-{i}{ext}"));
        i += 1;
    }
    target
}

fn open_with_explorer(path: &str) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer.exe").arg(path).spawn();
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn system_time_ms(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
}

fn random_suffix(len: usize) -> String {
    rng()
        .sample_iter(&Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

fn safe_id(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect()
}

fn safe_ext(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>()
}

fn safe_file_name(value: &str) -> String {
    value
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .take(180)
        .collect()
}

fn is_media_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    [".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mp3", ".wav"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

fn detect_image_bytes(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(("image/png", "png"));
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some(("image/jpeg", "jpg"));
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some(("image/webp", "webp"));
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some(("image/gif", "gif"));
    }
    None
}

fn percent_decode(value: &str) -> String {
    let mut out = String::new();
    let bytes = value.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[i + 1..i + 3], 16) {
                out.push(hex as char);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

#[derive(Debug)]
struct AppError {
    status: StatusCode,
    message: String,
}

impl AppError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }

    fn internal(error: impl std::fmt::Display) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: error.to_string(),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({ "success": false, "error": self.message })),
        )
            .into_response()
    }
}
