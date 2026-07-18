from pathlib import Path
import re
ROOT = Path(r"C:\wc\modules\walkchamp-race-progress\android\src\main\java\com\globalwalkerleague\walkchampraceprogress")

def clean_text(text):
    text = text.replace("\ufffd", "-")
    # Replace any non-ascii between "steps" and "$" in the walk body via regex below
    return text

def fix_fgs(path):
    raw = path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    text = clean_text(raw.decode("utf-8", errors="replace"))
    text = re.sub(
        r'return "Tracking your steps.*?\$\{String\.format',
        'return "Tracking your steps - ${String.format',
        text,
        count=1,
    )
    # Replace common mojibake dash sequences in comments/logs (bytes as latin1)
    text = text.encode("utf-8", errors="replace").decode("utf-8", errors="replace")
    # Strip remaining replacement chars next to dashes
    text = re.sub(r"\s*-\s*-\s*", " - ", text)
    # Fix " -?" style leftovers from em-dash mojibake
    text = re.sub(r"-\?+", "-", text)
    text = re.sub(r"\?-", "-", text)
    path.write_bytes(text.encode("utf-8"))
    for line in text.splitlines():
        if "Tracking your steps" in line:
            print("FGS body:", repr(line.strip()))
            break
    leftover = sum(1 for c in text if ord(c) == 0xFFFD)
    print("FGS replacement_chars=", leftover)

def fix_race(path):
    raw = path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    text = clean_text(raw.decode("utf-8", errors="replace"))
    text = re.sub(
        r'val openHint = if \(timeLeftSeconds <= 0\) ".*?Open" else ""',
        'val openHint = if (timeLeftSeconds <= 0) " - Open" else ""',
        text,
    )
    text = re.sub(
        r'return "\$stepsText steps .*? #\$rank/\$totalParticipants .*? Goal \$goalText\$openHint"',
        'return "$stepsText steps - #$rank/$totalParticipants - Goal $goalText$openHint"',
        text,
    )
    path.write_bytes(text.encode("utf-8"))
    for line in text.splitlines():
        if "stepsText steps" in line or "openHint =" in line:
            print("RACE:", repr(line.strip()))

fix_fgs(ROOT / "WalkChampRaceForegroundService.kt")
fix_race(ROOT / "RaceNotificationState.kt")
print("done")
