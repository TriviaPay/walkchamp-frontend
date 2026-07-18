from pathlib import Path
import re

ROOT = Path(
    r"C:\wc\modules\walkchamp-race-progress\android\src\main\java\com\globalwalkerleague\walkchampraceprogress"
)


def clean_text(text: str) -> str:
    for a, b in [
        ("\u00e2\u20ac\u00a2", " - "),  # mojibake bullet
        ("\u00e2\u20ac\u201d", " - "),
        ("\u00e2\u20ac\u201c", " - "),
        ("\u00e2\u20ac\u2014", " - "),
        ("\u00e2\u20ac\u2013", " - "),
        ("\ufffd", "-"),
    ]:
        text = text.replace(a, b)
    # Also the literal mojibake sequences if present as latin1 misread
    text = text.replace("â€¢", " - ")
    text = text.replace("â€”", " - ")
    text = text.replace("â€“", " - ")
    text = text.replace("â€\x9d", " - ")
    return text


def fix_fgs(path: Path) -> None:
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
    path.write_bytes(text.encode("utf-8"))
    print("fixed", path.name)
    for line in text.splitlines():
        if "Tracking your steps" in line:
            print(" body:", line.strip())
            break


def fix_race(path: Path) -> None:
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
    print("fixed", path.name)
    for line in text.splitlines():
        if "stepsText steps" in line or "openHint =" in line:
            print(" ", line.strip())


if __name__ == "__main__":
    fix_fgs(ROOT / "WalkChampRaceForegroundService.kt")
    fix_race(ROOT / "RaceNotificationState.kt")
