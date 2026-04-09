import re
import json
import logging

logger = logging.getLogger(__name__)


def fix_json(s: str) -> str:
    """Fix invalid JSON like duration_s:.1 → duration_s:0.1"""
    return re.sub(r":(\.\d)", r":0\1", s)


def try_parse_json(s: str) -> dict | None:
    try:
        parsed = json.loads(fix_json(s))
        if isinstance(parsed, dict) and "operation" in parsed:
            return parsed
    except (json.JSONDecodeError, ValueError):
        pass
    return None


def parse_progress_line(line: str) -> dict | None:
    """Parse install.sh / test.sh progress lines.

    Formats:
      [N/TOTAL] Label...              → in_progress
      [N/TOTAL] Label — PASS (msg)    → pass
      [N/TOTAL] Label — FAIL: msg     → fail
      [N/TOTAL] Label — SKIPPED       → skipped

    Note: — is Unicode em-dash U+2014
    """
    # PASS
    m = re.match(r"\[(\d+)/\d+\]\s+(.+?)\s+\u2014\s+PASS\s*\((.+?)\)", line)
    if m:
        return {"step_number": int(m.group(1)), "status": "pass", "message": m.group(3)}

    # FAIL
    m = re.match(r"\[(\d+)/\d+\]\s+(.+?)\s+\u2014\s+FAIL:\s*(.*)", line)
    if m:
        return {"step_number": int(m.group(1)), "status": "fail", "message": m.group(3)}

    # SKIPPED
    m = re.match(r"\[(\d+)/\d+\]\s+(.+?)\s+\u2014\s+SKIPPED", line)
    if m:
        return {"step_number": int(m.group(1)), "status": "skipped", "message": "Skipped"}

    # In progress
    m = re.match(r"\[(\d+)/\d+\]\s+(.+?)\.{3}", line)
    if m:
        return {"step_number": int(m.group(1)), "status": "in_progress", "message": m.group(2).strip()}

    return None


class OutputProcessor:
    """Processes SSH output stream, extracts progress events and final JSON."""

    def __init__(self):
        self.all_output = ""
        self.json_buffer = ""
        self.collecting_json = False
        self.final_json: dict | None = None
        self.step_timers: dict[int, float] = {}

    def process_data(self, data: str) -> list[dict]:
        """Process a chunk of data, return list of events."""
        self.all_output += data
        events = []

        if self.collecting_json:
            self.json_buffer += data
            parsed = try_parse_json(self.json_buffer)
            if parsed:
                self.final_json = parsed
                self.collecting_json = False
                logger.info("Received JSON result (multi-chunk): %s", parsed.get("result"))
                return events
            last_brace = self.json_buffer.rfind("}")
            if last_brace > 0:
                parsed = try_parse_json(self.json_buffer[:last_brace + 1])
                if parsed:
                    self.final_json = parsed
                    self.collecting_json = False
                    logger.info("Received JSON result (trimmed): %s", parsed.get("result"))
                    return events
            return events

        for raw_line in data.split("\n"):
            trimmed = raw_line.strip()
            if not trimmed:
                continue

            # Check for JSON
            if "{" in trimmed and '"operation"' in trimmed:
                json_start = trimmed.index("{")
                candidate = trimmed[json_start:]
                parsed = try_parse_json(candidate)
                if parsed:
                    self.final_json = parsed
                    logger.info("Received JSON result: %s", parsed.get("result"))
                    continue
                else:
                    self.collecting_json = True
                    self.json_buffer = candidate
                    continue

            # Parse progress
            update = parse_progress_line(trimmed)
            if update:
                import time
                step_num = update["step_number"]
                if update["status"] == "in_progress":
                    self.step_timers[step_num] = time.time()
                elif update["status"] in ("pass", "fail"):
                    start = self.step_timers.get(step_num)
                    if start:
                        update["duration"] = round(time.time() - start, 1)
                events.append({"type": "step_update", "data": update})
            else:
                logger.info("SSH output: %s", trimmed)

        return events

    def extract_json_fallback(self) -> dict | None:
        """Scan full output for JSON after script exits."""
        if self.final_json:
            return self.final_json
        for line in self.all_output.split("\n"):
            trimmed = line.strip()
            if trimmed.startswith("{") and '"operation"' in trimmed:
                parsed = try_parse_json(trimmed)
                if parsed:
                    self.final_json = parsed
                    return parsed
        return None
