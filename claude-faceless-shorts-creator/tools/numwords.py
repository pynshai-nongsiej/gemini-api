#!/usr/bin/env python3
"""
numwords.py — expand digits into words Kokoro can pronounce properly.

Kokoro reads digit runs one-by-one ("100000" -> "one zero zero zero…").
expand_numbers() converts every number in a narration line to its spoken
form before synthesis:

  19%        -> nineteen percent
  $612       -> six hundred twelve dollars
  0.01%      -> zero point zero one percent
  1,000 MPH  -> one thousand miles per hour
  1054       -> ten fifty-four            (year-style reading)
  2,000,000  -> two million
"""
import re

ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
        "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
        "seventeen", "eighteen", "nineteen"]
TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
SCALES = [(10**12, "trillion"), (10**9, "billion"), (10**6, "million"), (10**3, "thousand")]


def _int_to_words(n):
    if n == 0:
        return "zero"
    out = []
    for scale, name in SCALES:
        if n >= scale:
            out.append(_int_to_words(n // scale) + " " + name)
            n %= scale
    if n >= 100:
        out.append(ONES[n // 100] + " hundred")
        n %= 100
    if n >= 20:
        out.append(TENS[n // 10] + ("-" + ONES[n % 10] if n % 10 else ""))
    elif n > 0:
        out.append(ONES[n])
    return " ".join(out)


def _year_words(n):
    """1054 -> 'ten fifty-four', 2000 -> 'two thousand' (year-style reading)."""
    if n % 100 == 0:
        return _int_to_words(n)
    hi, lo = divmod(n, 100)
    hi_words = _int_to_words(hi)
    lo_words = ("o" + str(lo)) if lo < 10 else _int_to_words(lo)
    return f"{hi_words} {lo_words}"


UNIT_WORDS = {"MPH": "miles per hour", "mph": "miles per hour",
              "kmh": "kilometers per hour", "km": "kilometers",
              "kg": "kilograms", "°C": "degrees celsius", "°F": "degrees fahrenheit"}


def _expand(m):
    tok = m.group(0)
    head = re.match(r"(\$?)(-?)([\d,]+(?:\.\d+)?)(%?)\s*([A-Za-z°]+)?", tok)
    dollar, neg, core, percent, unit = head.groups()
    suffix = ""
    if percent:
        suffix += " percent"
    if unit:
        suffix += " " + UNIT_WORDS.get(unit, unit)
    if dollar:
        suffix += " dollars"

    core = core.replace(",", "")
    if "." in core:
        whole, dec = core.split(".", 1)
        words = _int_to_words(int(whole or 0)) + " point " + " ".join(ONES[int(d)] for d in dec)
    else:
        n = int(core or 0)
        # 4-digit numbers read as years (documentary convention)
        if 1000 <= n <= 2099 and not dollar and not percent and not unit:
            words = _year_words(n)
        else:
            words = _int_to_words(n)
    return ("negative " if neg else "") + words + suffix


# number possibly prefixed with $, followed by %, a unit, or nothing
NUM_RE = re.compile(
    r"\$?-?\d[\d,]*(?:\.\d+)?%?(?![a-zA-Z])(?:\s*(?:MPH|mph|kmh|km|kg|°C|°F))?"
)

SPECIALS = {"401k": "four-oh-one-kay", "401(K)": "four-oh-one-kay",
            "403b": "four-oh-three-be", "403(b)": "four-oh-three-be"}


def expand_numbers(text):
    """Convert every digit-run in `text` to its spoken form."""
    if not text:
        return text
    for k, v in SPECIALS.items():
        text = re.sub(re.escape(k), v, text, flags=re.IGNORECASE)
    return NUM_RE.sub(_expand, text)


if __name__ == "__main__":
    import sys
    for t in sys.argv[1:] or ["19% of your paycheck", "In 1054, a second sun appeared",
                              "$612 drained", "0.01% interest", "1,000 MPH winds",
                              "2,000,000 years", "The 401k fee is 0.65%"]:
        print(f"  {t!r}\n    -> {expand_numbers(t)!r}")
