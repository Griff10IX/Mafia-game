# Send transactional email via Resend (works from DigitalOcean; DO blocks SMTP on Droplets).
# Set RESEND_API_KEY and MAIL_FROM in .env. If RESEND_API_KEY is unset, emails are skipped (dev).
import logging
import os

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "").strip()
MAIL_FROM = os.environ.get("MAIL_FROM", "Mafia Wars <onboarding@resend.dev>").strip()
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000").rstrip("/")


def is_email_configured() -> bool:
    """True if Resend API key is set (emails will be sent)."""
    return bool(RESEND_API_KEY)


def verification_link(token: str) -> str:
    """Build the full verification URL for dev fallback or copy-paste."""
    return f"{FRONTEND_URL}/verify-email?token={token}"


def send_email(to: str, subject: str, html: str) -> bool:
    """Send one email. Returns True if sent, False if skipped (no API key). Logs and swallows errors."""
    if not RESEND_API_KEY:
        logger.info("Email not sent (RESEND_API_KEY not set): to=%s subject=%s", to, subject)
        return False
    try:
        import resend
        resend.api_key = RESEND_API_KEY
        resend.Emails.send({
            "from": MAIL_FROM,
            "to": [to],
            "subject": subject,
            "html": html,
        })
        logger.info("Email sent: to=%s subject=%s", to, subject)
        return True
    except Exception as e:
        logger.exception("Failed to send email to %s: %s", to, e)
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
