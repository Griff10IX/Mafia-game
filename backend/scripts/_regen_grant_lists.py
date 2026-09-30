"""Regenerate THEMES/BACKS lists in _grant_gf_crime_gta_cosmetics_live.py from catalogs."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from utils.profile_background_themes import CRIME_GTA_COSMETIC_THEME_IDS  # noqa: E402
from utils.blackjack_card_backs import CRIME_GTA_COSMETIC_BACK_IDS  # noqa: E402

path = Path(__file__).resolve().parent / "_grant_gf_crime_gta_cosmetics_live.py"
text = path.read_text(encoding="utf-8")
themes_block = "THEMES = [\n" + "".join(f'    "{t}",\n' for t in CRIME_GTA_COSMETIC_THEME_IDS) + "]"
backs_block = "BACKS = [\n" + "".join(f'    "{b}",\n' for b in CRIME_GTA_COSMETIC_BACK_IDS) + "]"
import re

text2 = re.sub(r"THEMES = \[[\s\S]*?\]", themes_block, text, count=1)
text2 = re.sub(r"BACKS = \[[\s\S]*?\]", backs_block, text2, count=1)
path.write_text(text2, encoding="utf-8")
print("updated", path.name, "themes", len(CRIME_GTA_COSMETIC_THEME_IDS), "backs", len(CRIME_GTA_COSMETIC_BACK_IDS))
