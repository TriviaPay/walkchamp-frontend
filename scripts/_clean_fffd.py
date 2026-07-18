from pathlib import Path
p = Path(r"C:\wc\modules\walkchamp-race-progress\android\src\main\java\com\globalwalkerleague\walkchampraceprogress\WalkChampRaceForegroundService.kt")
raw = p.read_bytes()
if raw.startswith(b"\xef\xbb\xbf"):
    raw = raw[3:]
text = raw.decode("utf-8", errors="replace")
text = text.replace("\ufffd?", " -")
text = text.replace("\ufffd", "-")
text = text.replace(" -?", " -")
p.write_bytes(text.encode("utf-8"))
bad = sum(1 for c in text if ord(c) == 0xFFFD)
print("replacement_left=", bad)
print("body_ok=", 'Tracking your steps - ${String.format' in text)
