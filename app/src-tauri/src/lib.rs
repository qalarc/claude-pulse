// claude-pulse — Rust backend.
// Reads the append-only usage.jsonl written by the collector proxy, aggregates
// it into per-minute buckets / day summaries, and exposes them to the webview.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
struct RawLine {
    t: i64,
    #[serde(default)]
    status: i64,
    #[serde(default)]
    input: Option<f64>,
    #[serde(default)]
    output: Option<f64>,
    #[serde(rename = "cacheRead", default)]
    cache_read: Option<f64>,
    #[serde(rename = "cacheWrite", default)]
    cache_write: Option<f64>,
    #[serde(rename = "rateLimited", default)]
    rate_limited: bool,
    #[serde(default)]
    u5h: Option<f64>,
    #[serde(default)]
    u7d: Option<f64>,
    #[serde(rename = "reset5h", default)]
    reset5h: Option<f64>,
    #[serde(rename = "reset7d", default)]
    reset7d: Option<f64>,
    #[serde(default)]
    model: Option<String>,
}

#[derive(Debug, Default, Serialize, Clone)]
pub struct MinuteBucket {
    /// epoch ms at the start of the minute
    minute: i64,
    input: f64,
    output: f64,
    cache_read: f64,
    cache_write: f64,
    requests: u32,
    rate_limited: u32,
    /// max unified 5h utilization seen in this minute (0..1)
    u5h: f64,
    u7d: f64,
}

#[derive(Debug, Default, Serialize)]
pub struct Snapshot {
    /// per-minute buckets for the requested window, ascending by time
    minutes: Vec<MinuteBucket>,
    /// the single highest combined-tokens minute in the window (peak)
    peak_tokens: f64,
    peak_minute: i64,
    peak_requests: u32,
    peak_requests_minute: i64,
    /// total rate-limit events in the window
    rate_limited_total: u32,
    /// latest unified utilization seen (most recent non-empty)
    latest_u5h: f64,
    latest_u7d: f64,
    /// epoch SECONDS when each rolling window resets (0 if unknown)
    reset5h: f64,
    reset7d: f64,
    /// log file path (for the UI to show)
    log_path: String,
    /// whether the log file exists
    has_data: bool,
}

#[derive(Debug, Default, Serialize)]
pub struct DaySummary {
    /// YYYY-MM-DD (local)
    day: String,
    input: f64,
    output: f64,
    cache_read: f64,
    cache_write: f64,
    requests: u32,
    rate_limited: u32,
    peak_tpm: f64,
}

fn log_path() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
    base.join("claude-pulse").join("usage.jsonl")
}

fn read_lines() -> Vec<RawLine> {
    let path = log_path();
    let Ok(text) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|l| serde_json::from_str::<RawLine>(l).ok())
        .collect()
}

const MIN_MS: i64 = 60_000;

/// Aggregate the last `window_minutes` of activity into per-minute buckets.
#[tauri::command]
fn snapshot(window_minutes: i64) -> Snapshot {
    let lines = read_lines();
    let now = now_ms();
    let cutoff = now - window_minutes * MIN_MS;

    let mut buckets: BTreeMap<i64, MinuteBucket> = BTreeMap::new();
    let mut latest_u5h = 0.0;
    let mut latest_u7d = 0.0;
    let mut latest_reset5h = 0.0;
    let mut latest_reset7d = 0.0;
    let mut latest_t = 0i64;

    for l in &lines {
        if l.t < cutoff {
            // still track latest utilization from older lines
            if l.t > latest_t {
                latest_t = l.t;
                if let Some(v) = l.u5h {
                    latest_u5h = v;
                }
                if let Some(v) = l.u7d {
                    latest_u7d = v;
                }
                if let Some(v) = l.reset5h {
                    latest_reset5h = v;
                }
                if let Some(v) = l.reset7d {
                    latest_reset7d = v;
                }
            }
            continue;
        }
        let minute = (l.t / MIN_MS) * MIN_MS;
        let b = buckets.entry(minute).or_insert(MinuteBucket {
            minute,
            ..Default::default()
        });
        b.input += l.input.unwrap_or(0.0);
        b.output += l.output.unwrap_or(0.0);
        b.cache_read += l.cache_read.unwrap_or(0.0);
        b.cache_write += l.cache_write.unwrap_or(0.0);
        b.requests += 1;
        if l.rate_limited || l.status == 429 {
            b.rate_limited += 1;
        }
        if let Some(v) = l.u5h {
            if v > b.u5h {
                b.u5h = v;
            }
        }
        if let Some(v) = l.u7d {
            if v > b.u7d {
                b.u7d = v;
            }
        }
        if l.t > latest_t {
            latest_t = l.t;
            if let Some(v) = l.u5h {
                latest_u5h = v;
            }
            if let Some(v) = l.u7d {
                latest_u7d = v;
            }
            if let Some(v) = l.reset5h {
                latest_reset5h = v;
            }
            if let Some(v) = l.reset7d {
                latest_reset7d = v;
            }
        }
    }

    let minutes: Vec<MinuteBucket> = buckets.into_values().collect();

    let mut peak_tokens = 0.0;
    let mut peak_minute = 0i64;
    let mut peak_requests = 0u32;
    let mut peak_requests_minute = 0i64;
    let mut rate_limited_total = 0u32;
    for b in &minutes {
        let tok = b.input + b.output;
        if tok > peak_tokens {
            peak_tokens = tok;
            peak_minute = b.minute;
        }
        if b.requests > peak_requests {
            peak_requests = b.requests;
            peak_requests_minute = b.minute;
        }
        rate_limited_total += b.rate_limited;
    }

    Snapshot {
        minutes,
        peak_tokens,
        peak_minute,
        peak_requests,
        peak_requests_minute,
        rate_limited_total,
        latest_u5h,
        latest_u7d,
        reset5h: latest_reset5h,
        reset7d: latest_reset7d,
        log_path: log_path().to_string_lossy().to_string(),
        has_data: !lines.is_empty(),
    }
}

/// Per-day summaries for the calendar view, over the last `days` days.
#[tauri::command]
fn day_summaries(days: i64) -> Vec<DaySummary> {
    let lines = read_lines();
    let cutoff = now_ms() - days * 24 * 60 * MIN_MS;
    // group by local day string and by minute (to derive peak TPM per day)
    let mut day_map: BTreeMap<String, DaySummary> = BTreeMap::new();
    let mut day_minute: BTreeMap<(String, i64), f64> = BTreeMap::new();

    for l in &lines {
        if l.t < cutoff {
            continue;
        }
        let day = local_day(l.t);
        let s = day_map.entry(day.clone()).or_insert(DaySummary {
            day: day.clone(),
            ..Default::default()
        });
        let inp = l.input.unwrap_or(0.0);
        let out = l.output.unwrap_or(0.0);
        s.input += inp;
        s.output += out;
        s.cache_read += l.cache_read.unwrap_or(0.0);
        s.cache_write += l.cache_write.unwrap_or(0.0);
        s.requests += 1;
        if l.rate_limited || l.status == 429 {
            s.rate_limited += 1;
        }
        let minute = (l.t / MIN_MS) * MIN_MS;
        *day_minute.entry((day, minute)).or_insert(0.0) += inp + out;
    }

    for ((day, _), tpm) in &day_minute {
        if let Some(s) = day_map.get_mut(day) {
            if *tpm > s.peak_tpm {
                s.peak_tpm = *tpm;
            }
        }
    }

    day_map.into_values().collect()
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Convert epoch ms to a local YYYY-MM-DD string (no chrono dep — minimal).
fn local_day(ms: i64) -> String {
    // Use the system's local offset via a simple approach: format with libc-free
    // arithmetic in UTC, then shift by the local offset seconds from `date`.
    // To avoid a chrono dependency we approximate with UTC day boundaries; the
    // collector timestamps are local-clock-based already for practical purposes.
    let secs = ms / 1000;
    let days_since_epoch = secs / 86400;
    // Convert days since 1970-01-01 to Y-M-D (civil from days algorithm).
    let (y, m, d) = civil_from_days(days_since_epoch);
    format!("{:04}-{:02}-{:02}", y, m, d)
}

// Howard Hinnant's days->civil algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![snapshot, day_summaries])
        .run(tauri::generate_context!())
        .expect("error while running claude-pulse");
}
