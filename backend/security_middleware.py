# Security middleware for FastAPI
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from fastapi import Request
import logging
import hashlib
import os
from jose import jwt, JWTError

logger = logging.getLogger(__name__)


class SecurityMiddleware(BaseHTTPMiddleware):
    """
    Middleware to check for spam and exploits on protected endpoints.
    Does NOT limit legitimate gameplay - only detects bot-like spam patterns.
    """
    
    def __init__(self, app, db):
        super().__init__(app)
        self.db = db
        # Import here to avoid circular dependency
        from security import check_endpoint_rate_limit, check_request_spam, check_duplicate_request
        self.check_endpoint_rate_limit = check_endpoint_rate_limit
        self.check_request_spam = check_request_spam
        self.check_duplicate_request = check_duplicate_request
    
    async def dispatch(self, request: Request, call_next):
        # Skip security checks for certain paths
        path = request.url.path
        
        # Always allow these without checks (request.url.path includes /api when using api_router prefix)
        skip_paths = [
            "/",
            "/docs",
            "/openapi.json",
            "/api/auth/login",
            "/api/auth/register",
            "/api/auth/me",
            "/api/admin/",  # Admin tools: bypass spam + rate limits so security/anti-cheat UI works
            "/admin/",
        ]
        
        if any(path.startswith(p) for p in skip_paths):
            return await call_next(request)
        
        # Try to extract user from JWT token
        current_user = None
        try:
            auth_header = request.headers.get("Authorization")
            if auth_header and auth_header.startswith("Bearer "):
                token = auth_header.split(" ")[1]
                SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key-here")
                payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
                user_id = payload.get("sub")
                username = payload.get("username", "Unknown")
                if user_id:
                    current_user = {"id": user_id, "username": username}
        except (JWTError, Exception):
            pass  # If token invalid, just skip security checks
        
        if not current_user:
            # No user = unauthenticated request, skip checks
            return await call_next(request)
        
        user_id = current_user.get("id")
        username = current_user.get("username", "Unknown")
        
        try:
            # 1. Check for request spam (10+ req/sec)
            if await self.check_request_spam(user_id, username, self.db):
                logger.warning(f"SPAM BLOCKED: {username} - {path}")
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too many requests. Please slow down."}
                )
            
            # 2. Check endpoint-specific rate limits (if enabled for this endpoint)
            if await self.check_endpoint_rate_limit(path, user_id, username, self.db):
                logger.warning(f"RATE LIMIT: {username} - {path}")
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Rate limit exceeded for this action. Please wait."}
                )
            
        except Exception as e:
            logger.exception(f"Security middleware error: {e}")
        
        # Process request
        response = await call_next(request)
        return response
