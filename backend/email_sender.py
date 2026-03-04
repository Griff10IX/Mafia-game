# Send transactional email: SMTP (e.g. IONOS Mail) or Resend API.
# Option 1 – SMTP: set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM (e.g. IONOS: smtp.ionos.co.uk, 587).
# Option 2 – Resend: set RESEND_API_KEY and MAIL_FROM (works from DigitalOcean; DO blocks port 25, sometimes 587).
# If neither is set, emails are skipped (dev).
import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "").strip()
MAIL_FROM = os.environ.get("MAIL_FROM", "Mafia Wars <onboarding@resend.dev>").strip()
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000").rstrip("/")

# SMTP (e.g. IONOS Mail)
SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "").strip()
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "").strip() or os.environ.get("SMTP_PASS", "").strip()
SMTP_USE_TLS = os.environ.get("SMTP_USE_TLS", "true").lower() in ("1", "true", "yes")


def is_email_configured() -> bool:
    """True if SMTP or Resend is configured (emails will be sent)."""
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD) or bool(RESEND_API_KEY)


def _send_via_smtp(to: str, subject: str, html: str) -> bool:
    """Send one email via SMTP. Returns True on success."""
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = MAIL_FROM
        msg["To"] = to
        msg.attach(MIMEText(html, "html", "utf-8"))
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
            if SMTP_USE_TLS:
                server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(MAIL_FROM, [to], msg.as_string())
        logger.info("Email sent via SMTP: to=%s subject=%s", to, subject)
        return True
    except Exception as e:
        logger.exception("SMTP failed to %s: %s", to, e)
        return False


def _send_via_resend(to: str, subject: str, html: str) -> bool:
    """Send one email via Resend API. Returns True on success."""
    try:
        import resend
        resend.api_key = RESEND_API_KEY
        resend.Emails.send({
            "from": MAIL_FROM,
            "to": [to],
            "subject": subject,
            "html": html,
        })
        logger.info("Email sent via Resend: to=%s subject=%s", to, subject)
        return True
    except Exception as e:
        logger.exception("Resend failed to %s: %s", to, e)
        return False


def verification_link(token: str) -> str:
    """Build the full verification URL for dev fallback or copy-paste."""
    return f"{FRONTEND_URL}/verify-email?token={token}"


def send_email(to: str, subject: str, html: str) -> bool:
    """Send one email. Prefer SMTP if configured, else Resend. Returns True if sent, False if skipped or failed."""
    if SMTP_HOST and SMTP_USER and SMTP_PASSWORD:
        return _send_via_smtp(to, subject, html)
    if RESEND_API_KEY:
        return _send_via_resend(to, subject, html)
    logger.info("Email not sent (no SMTP or RESEND_API_KEY): to=%s subject=%s", to, subject)
    return False


def send_verification_email(to: str, username: str, token: str) -> bool:
    """Send 'Verify your email' with link to FRONTEND_URL/verify-email?token=..."""
    verify_url = f"{FRONTEND_URL}/verify-email?token={token}"
    html = f"""
    <p>Hi {username},</p>
    <p>Thanks for joining Mafia Wars. Please verify your email by clicking the link below:</p>
    <p><a href="{verify_url}">{verify_url}</a></p>
    <p>This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>
    <p>— Mafia Wars</p>
    """
    return send_email(to, "Verify your email – Mafia Wars", html)


def send_password_reset_email(to: str, username: str, token: str) -> bool:
    """Send password reset link to FRONTEND_URL/reset-password?token=..."""
    reset_url = f"{FRONTEND_URL}/reset-password?token={token}"
    html = f"""
    <p>Hi {username},</p>
    <p>You requested a password reset. Click the link below to set a new password:</p>
    <p><a href="{reset_url}">{reset_url}</a></p>
    <p>This link expires in 1 hour. If you didn't request a reset, ignore this email.</p>
    <p>— Mafia Wars</p>
    """
    return send_email(to, "Reset your password – Mafia Wars", html)
