#!/usr/bin/env python3
"""Print the messages between sessions in one Claude Code transcript.

Usage: transcript.py SESSION_ID CONFIG_DIR [CONFIG_DIR ...]

The script finds CONFIG_DIR/projects/*/SESSION_ID.jsonl. It prints one JSON
array of events, oldest first. Each event has one of these shapes.

  {"kind": "in", "at": ms, "text": "...<cross-session-message ...>...</...>"}
  {"kind": "out", "at": ms, "id": "toolu_...", "to": "...", "message": "..."}
  {"kind": "error", "id": "toolu_...", "text": "..."}

The mod parses the envelopes itself, so this script and the mod share one
parser. The script prints the last MAX_EVENTS events. A transcript can hold tens of megabytes, which is over the 4 MiB that
$.fs.read takes. So the script streams the file and prints only the events.
It skips a subagent row (isSidechain) and every row that is not a user row,
an assistant row or an attachment.
"""

import glob
import json
import os
import sys
from datetime import datetime

# The mod reads at most 4 MiB of output. 2000 events of usual length stay
# under it, and the pane draws far fewer.
MAX_EVENTS = 2000


def millis(stamp):
    try:
        return int(datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() * 1000)
    except (AttributeError, ValueError):
        return None


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and isinstance(b.get("text"), str))
    return ""


def events(row, sends):
    kind = row.get("type")
    at = millis(row.get("timestamp"))
    if kind == "attachment":
        prompt = (row.get("attachment") or {}).get("prompt")
        text = text_of(prompt)
        if "<cross-session-message" in text:
            yield {"kind": "in", "at": at, "text": text}
        return
    content = (row.get("message") or {}).get("content")
    if kind == "user":
        text = text_of(content)
        if "<cross-session-message" in text:
            yield {"kind": "in", "at": at, "text": text}
        for block in content if isinstance(content, list) else []:
            if isinstance(block, dict) and block.get("type") == "tool_result" and block.get("is_error") is True and block.get("tool_use_id") in sends:
                yield {"kind": "error", "id": block.get("tool_use_id"), "text": text_of(block.get("content"))}
    elif kind == "assistant":
        for block in content if isinstance(content, list) else []:
            if not isinstance(block, dict) or block.get("type") != "tool_use" or block.get("name") != "SendMessage":
                continue
            given = block.get("input") or {}
            if isinstance(given.get("message"), str):
                sends.add(block.get("id"))
                yield {"kind": "out", "at": at, "id": block.get("id"), "to": str(given.get("to")), "message": given["message"]}


def find(session_id, config_dirs):
    for config_dir in config_dirs:
        found = glob.glob(os.path.join(config_dir, "projects", "*", f"{session_id}.jsonl"))
        if found:
            return found[0]
    return None


def main():
    if len(sys.argv) < 3:
        print("usage: transcript.py SESSION_ID CONFIG_DIR [CONFIG_DIR ...]", file=sys.stderr)
        return 2
    path = find(sys.argv[1], sys.argv[2:])
    if path is None:
        print(f"no transcript for session {sys.argv[1]}", file=sys.stderr)
        return 1
    out = []
    sends = set()
    with open(path, encoding="utf-8", errors="replace") as transcript:
        for line in transcript:
            # A cheap test first. Most rows hold no message between sessions.
            if "cross-session-message" not in line and "SendMessage" not in line and '"is_error":true' not in line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("isSidechain") is True:
                continue
            out.extend(events(row, sends))
    json.dump(out[-MAX_EVENTS:], sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
