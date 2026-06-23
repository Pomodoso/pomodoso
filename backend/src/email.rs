//! Transactional email via Resend. Best-effort: a failure never breaks the
//! request that triggered it — errors are logged and swallowed.

use serde_json::json;

use crate::AppState;

const APP_URL: &str = "https://pomodoso.com";
// Brand mark for the email header. Must be an absolute, hosted URL (Gmail strips
// data URIs / SVG). Served from the marketing site's public dir (email-logo.png).
const LOGO_URL: &str = "https://pomodoso.com/email-logo.png";

/// Fire-and-forget: spawns the send so the caller (a webhook / `/me`) returns
/// immediately and email latency never blocks the user.
pub fn send_in_background(state: &AppState, to: String, subject: String, html: String) {
    let api_key = match &state.config.resend_api_key {
        Some(k) => k.clone(),
        None => return, // emails disabled (no key) — already warned at boot
    };
    let from = state
        .config
        .resend_from_email
        .clone()
        // Until pomodoso.com is verified in Resend, send from the verified
        // otpilot.app domain (display name still "Pomodoso").
        .unwrap_or_else(|| "Pomodoso <noreply@otpilot.app>".to_owned());
    let http = state.http.clone();

    tokio::spawn(async move {
        let res = http
            .post("https://api.resend.com/emails")
            .bearer_auth(api_key)
            .json(&json!({ "from": from, "to": [to], "subject": subject, "html": html }))
            .send()
            .await;
        match res {
            Ok(r) if r.status().is_success() => {}
            Ok(r) => {
                let status = r.status();
                let body = r.text().await.unwrap_or_default();
                tracing::warn!("resend: send failed ({status}): {body}");
            }
            Err(e) => tracing::warn!("resend: request error: {e}"),
        }
    });
}

pub fn send_welcome(state: &AppState, to: &str, name: &str) {
    let first = first_name(name, to);
    send_in_background(
        state,
        to.to_owned(),
        "Welcome to Pomodoso 🍅".to_owned(),
        welcome_html(&first),
    );
}

pub fn send_payment_confirmation(state: &AppState, to: &str, name: &str, plan: &str) {
    let first = first_name(name, to);
    let (plan_label, blurb) = match plan {
        "founder_lifetime" => (
            "Founder Lifetime",
            "You have lifetime access to every Pomodoso feature — no recurring fees, ever. Thank you for being an early supporter.",
        ),
        _ => (
            "Pro",
            "Your Pro plan is active: multi-device sync, the web dashboard, unlimited workspaces and full history are all unlocked.",
        ),
    };
    send_in_background(
        state,
        to.to_owned(),
        "Your Pomodoso subscription is active 🎉".to_owned(),
        payment_html(&first, plan_label, blurb),
    );
}

fn first_name(name: &str, email: &str) -> String {
    let n = name.trim();
    if !n.is_empty() && !n.contains('@') {
        return n.split_whitespace().next().unwrap_or(n).to_owned();
    }
    email.split('@').next().unwrap_or("there").to_owned()
}

// ─── Templates ─────────────────────────────────────────────────────────────────
// Inline styles + table layout: the only thing that renders consistently across
// Gmail / Outlook / Apple Mail.

fn shell(body: &str) -> String {
    format!(
        r#"<!doctype html><html><body style="margin:0;padding:0;background:#FBFAF7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBFAF7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border:1px solid #E8E5DD;border-radius:14px;overflow:hidden;">
      <tr><td style="padding:28px 32px 0;">
        <div style="display:inline-flex;align-items:center;gap:8px;">
          <img src="{LOGO_URL}" width="26" height="26" alt="Pomodoso" style="display:block;border:0;outline:none;text-decoration:none;" />
          <span style="font-size:16px;font-weight:700;color:#1A1A17;">Pomodoso</span>
        </div>
      </td></tr>
      {body}
      <tr><td style="padding:24px 32px 28px;border-top:1px solid #F0EDE6;">
        <p style="margin:0;font-size:11px;line-height:1.6;color:#98948A;">
          You're receiving this because you have a Pomodoso account.<br>
          Pomodoso · <a href="https://pomodoso.com" style="color:#98948A;">pomodoso.com</a> · <a href="mailto:support@pomodoso.com" style="color:#98948A;">support@pomodoso.com</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>"#
    )
}

fn button(href: &str, label: &str) -> String {
    format!(
        r#"<a href="{href}" style="display:inline-block;background:#C8553D;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:9px;">{label}</a>"#
    )
}

fn welcome_html(first: &str) -> String {
    let body = format!(
        r#"<tr><td style="padding:20px 32px 0;">
        <h1 style="margin:0 0 12px;font-size:21px;font-weight:700;color:#1A1A17;letter-spacing:-0.3px;">Welcome, {first} 👋</h1>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#5F5D55;">
          Pomodoso brings your day into one place — your tasks and top priorities, a pomodoro timer that logs real time per task, your daily habits, and your calendar.
        </p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#5F5D55;">
          A few good first steps: pin your top 3 priorities for today, start a pomodoro on a task, and add the habits you want to keep. Connect Google Calendar to see your meetings right alongside your work.
        </p>
        <p style="margin:0 0 8px;">{cta}</p>
      </td></tr>"#,
        first = first,
        cta = button(APP_URL, "Open the dashboard")
    );
    shell(&body)
}

fn payment_html(first: &str, plan_label: &str, blurb: &str) -> String {
    let body = format!(
        r#"<tr><td style="padding:20px 32px 0;">
        <h1 style="margin:0 0 12px;font-size:21px;font-weight:700;color:#1A1A17;letter-spacing:-0.3px;">You're on {plan_label} 🎉</h1>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#5F5D55;">Thanks for upgrading, {first}. {blurb}</p>
        <p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#98948A;">Need an invoice or want to manage your plan? Open Billing from the dashboard sidebar.</p>
        <p style="margin:0 0 8px;">{cta}</p>
      </td></tr>"#,
        plan_label = plan_label,
        first = first,
        blurb = blurb,
        cta = button(&format!("{APP_URL}/settings/billing"), "Manage your plan")
    );
    shell(&body)
}
