# Text utilities (emoji stripping, etc.)
import re

# Unicode ranges for emoji (emoticons, symbols, pictographs, transport, flags, misc symbols).
# Used to strip emojis from designer comp topics and comments.
_EMOJI_PATTERN = re.compile(
    "["
    "\U0001F600-\U0001F64F"   # emoticons
    "\U0001F300-\U0001F5FF"   # symbols & pictographs
    "\U0001F680-\U0001F6FF"   # transport & map
    "\U0001F1E0-\U0001F1FF"   # flags
    "\U00002702-\U000027B0"
    "\U000024C2-\U0001F251"
    "\U0001F900-\U0001F9FF"   # supplemental symbols
    "\U0001FA00-\U0001FA6F"
    "\U0001FA70-\U0001FAFF"
    "\u2600-\u26FF"           # misc symbols
    "\u2700-\u27BF"
    "\uFE00-\uFE0F"           # variation selectors (emoji presentation)
    "\u200D"                  # zero-width joiner (emoji sequences)
    "]+",
    flags=re.UNICODE,
)


def strip_emoji(text: str) -> str:
    """Remove emoji and related Unicode characters from a string. Returns stripped string."""
    if not text or not isinstance(text, str):
        return text
    return _EMOJI_PATTERN.sub("", text)
