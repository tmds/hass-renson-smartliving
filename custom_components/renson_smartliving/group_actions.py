"""Group action (gateway automation) bytecode validation.

The gateway stores automations ("group actions") as a flat list of
(action_type, action_number) pairs. The gateway's own mapper silently
DROPS unknown action types when saving (see GroupActionMapper.
classic_actions_to_core_actions: unknown types fall through the if-chain),
so the editor must validate BEFORE writing or edits would silently
corrupt an automation.

Opcode semantics: gateway/hal/mappers_core/group_action.py of fw 3.9.9.
"""

from __future__ import annotations

# Action types the editor fully understands and can round-trip.
SUPPORTED_ACTION_TYPES = frozenset(
    {
        2,  # run another group action
        68, 69,  # virtual input press / release
        100, 101, 102, 103,  # shutter up / down / stop / toggle
        104, 105, 106, 107,  # shutter group up / down / stop / toggle
        108, 109, 110, 111,  # shutter up/stop/up, down/stop/down (+groups)
        116, 117,  # disable / enable input
        160, 161, 162,  # output off / on / toggle
        163, 164,  # all lights off / all outputs off
        165, 166,  # output on at min / max dimmer
        169, 170,  # dimmer to min / max (state unchanged)
        171, 172, 173,  # floor/group lights off / on / toggle
        *range(176, 185),  # output on at 10..90%
        *range(185, 195),  # toggle output at 10..100%
        *range(195, 201),  # output on with timer (overrules)
        *range(201, 207),  # output on with timer (no overrule)
        237, 238, 239,  # validation bit set / clear / toggle
        240,  # IF / AND / OR / THEN / ELSE / ENDIF
        241, 242,  # condition: input on / off
        243, 244,  # condition: output on / off
        245, 246,  # condition: validation bit on / off
        247, 248, 249, 250,  # sensor comparison triplets
        254,  # reset master
    }
)

_IF = (240, 0)
_AND = (240, 1)
_OR = (240, 2)
_THEN = (240, 10)
_ELSE = (240, 20)
_ENDIF = (240, 255)

_CONDITION_TYPES = frozenset({241, 242, 243, 244, 245, 246, 247})


class GroupActionValidationError(ValueError):
    """Raised when an action list cannot be safely written to the gateway."""


def parse_actions(actions: str) -> list[int]:
    """Parse a comma-separated pair string into a list of ints."""
    text = (actions or "").strip()
    if not text:
        return []
    try:
        values = [int(part) for part in text.split(",")]
    except ValueError as err:
        raise GroupActionValidationError(
            f"Actions must be comma-separated integers: {err}"
        ) from err
    if any(v < 0 or v > 65535 for v in values):
        raise GroupActionValidationError("Action values must be 0..65535")
    return values


def validate_actions(values: list[int]) -> None:
    """Validate a classic action list before writing it to the gateway.

    Checks: even length, known action types, and a structurally sound
    IF/THEN/ELSE block nesting (conditions before THEN, THEN before ELSE,
    every IF closed by ENDIF, no stray THEN/ELSE/ENDIF).
    """
    if len(values) % 2 != 0:
        raise GroupActionValidationError(
            "Actions must be (action_type, action_number) pairs (even length)"
        )

    pairs = list(zip(values[0::2], values[1::2], strict=False))
    unknown = sorted({t for t, _ in pairs if t not in SUPPORTED_ACTION_TYPES})
    if unknown:
        raise GroupActionValidationError(
            f"Unsupported action types: {', '.join(str(t) for t in unknown)}"
        )

    # IF-block structure: stack of block states.
    # States: "if" (expecting conditions), "then", "else".
    stack: list[str] = []
    for pair in pairs:
        if pair == _IF:
            stack.append("if")
        elif pair in (_AND, _OR):
            if not stack or stack[-1] != "if":
                raise GroupActionValidationError(
                    f"AND/OR must combine conditions inside an IF block "
                    f"(pair {pair[0]},{pair[1]})"
                )
        elif pair in (_THEN, _ELSE):
            if not stack:
                raise GroupActionValidationError(
                    f"THEN/ELSE outside an IF block (pair {pair[0]},{pair[1]})"
                )
            if pair == _THEN:
                stack[-1] = "then"
            else:
                if stack[-1] != "then":
                    raise GroupActionValidationError(
                        "ELSE without a preceding THEN"
                    )
                stack[-1] = "else"
        elif pair == _ENDIF:
            if not stack:
                raise GroupActionValidationError("ENDIF without IF")
            stack.pop()
        # Any other (action or condition) type is fine anywhere.

    if stack:
        raise GroupActionValidationError("IF block not closed with ENDIF")
