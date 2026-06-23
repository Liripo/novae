import time

from rich.console import Console, Group
from rich.live import Live
from rich.markdown import Markdown
from rich.panel import Panel
from rich.status import Status
from rich.text import Text

from agentscope.agent import Agent
from agentscope.event import (
    TextBlockDeltaEvent,
    ThinkingBlockDeltaEvent,
    ToolCallStartEvent,
    ToolCallDeltaEvent,
    ToolResultStartEvent,
    ToolResultTextDeltaEvent,
    RequireUserConfirmEvent,
    ExceedMaxItersEvent,
)
from agentscope.event._event import ConfirmResult, UserConfirmResultEvent
from agentscope.message import UserMsg

UPDATE_INTERVAL = 0.15


def _format_tool_calls(tool_calls: dict[str, dict]) -> Text:
    content = Text()
    for tc in tool_calls.values():
        name = tc.get("name", "unknown")
        args = tc.get("args", "")
        content.append(f"  {name}", style="bold yellow")
        if args:
            content.append(f"({args})\n", style="dim")
        else:
            content.append("\n")
    return content


def _confirm_tool_call(live: Live, tool_call) -> bool:
    live.stop()
    console = Console()
    console.print()
    console.print(Panel(
        Text(f"{tool_call.name}({tool_call.input})", style="yellow"),
        title="Tool Call",
        border_style="yellow",
    ))
    try:
        answer = input("Allow? [y/N] ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        answer = "n"
    live.start()
    return answer == "y"


def _build_panels(
    status: Status,
    msg_panel: Panel,
    thinking_buffer: str,
    tool_calls: dict[str, dict],
    text_buffer: str,
    start_time: float,
    markdown: bool,
) -> list:
    panels = [status, msg_panel]

    if thinking_buffer:
        panels.append(Panel(
            Text(thinking_buffer, style="dim"),
            title="Thinking",
            border_style="green",
        ))

    if tool_calls:
        panels.append(Panel(
            _format_tool_calls(tool_calls),
            title="Tool Calls",
            border_style="yellow",
        ))

    if text_buffer:
        elapsed = time.monotonic() - start_time
        content = Markdown(text_buffer) if markdown else Text(text_buffer)
        panels.append(Panel(
            content,
            title=f"Response ({elapsed:.1f}s)",
            border_style="blue",
        ))

    return panels


async def print_response_stream(
    agent: Agent,
    message: str,
    markdown: bool = True,
) -> None:
    console = Console()
    text_buffer = ""
    thinking_buffer = ""
    tool_calls: dict[str, dict] = {}
    tool_results: dict[str, str] = {}

    with Live(console=console, refresh_per_second=10) as live:
        status = Status("Thinking...", spinner="dots", speed=0.4)
        msg_panel = Panel(
            Text(message, style="green"),
            title="Message",
            border_style="cyan",
        )
        live.update(Group(*[status, msg_panel]))

        start_time = time.monotonic()
        last_update = start_time
        reply_id: str | None = None
        pending_confirm: RequireUserConfirmEvent | None = None
        text_changed = False
        thinking_changed = False

        async for event in agent.reply_stream(inputs=UserMsg(name="user", content=message)):
            now = time.monotonic()

            if hasattr(event, "reply_id"):
                reply_id = event.reply_id

            if isinstance(event, TextBlockDeltaEvent):
                text_buffer += event.delta
                text_changed = True
            elif isinstance(event, ThinkingBlockDeltaEvent):
                thinking_buffer += event.delta
                thinking_changed = True
            elif isinstance(event, ToolCallStartEvent):
                tool_calls[event.tool_call_id] = {
                    "name": event.tool_call_name,
                    "args": "",
                }
            elif isinstance(event, ToolCallDeltaEvent):
                if event.tool_call_id in tool_calls:
                    tool_calls[event.tool_call_id]["args"] += event.delta
            elif isinstance(event, ToolResultStartEvent):
                tool_results[event.tool_call_id] = ""
            elif isinstance(event, ToolResultTextDeltaEvent):
                if event.tool_call_id in tool_results:
                    tool_results[event.tool_call_id] += event.delta
            elif isinstance(event, RequireUserConfirmEvent):
                pending_confirm = event
            elif isinstance(event, ExceedMaxItersEvent):
                status.update("Max iterations reached", spinner="red_ticker")

            if now - last_update >= UPDATE_INTERVAL and (text_changed or thinking_changed):
                panels = _build_panels(status, msg_panel, thinking_buffer, tool_calls, text_buffer, start_time, markdown)
                live.update(Group(*panels))
                last_update = now
                text_changed = False
                thinking_changed = False

            if pending_confirm is not None and reply_id is not None:
                panels = _build_panels(status, msg_panel, thinking_buffer, tool_calls, text_buffer, start_time, markdown)
                live.update(Group(*panels))

                confirm_results = []
                for tc in pending_confirm.tool_calls:
                    confirmed = _confirm_tool_call(live, tc)
                    confirm_results.append(ConfirmResult(confirmed=confirmed, tool_call=tc))

                confirm_event = UserConfirmResultEvent(reply_id=reply_id, confirm_results=confirm_results)
                pending_confirm = None

                async for ce in agent.reply_stream(inputs=confirm_event):
                    if hasattr(ce, "reply_id"):
                        reply_id = ce.reply_id

                    if isinstance(ce, TextBlockDeltaEvent):
                        text_buffer += ce.delta
                        text_changed = True
                    elif isinstance(ce, ThinkingBlockDeltaEvent):
                        thinking_buffer += ce.delta
                        thinking_changed = True
                    elif isinstance(ce, ToolCallStartEvent):
                        tool_calls[ce.tool_call_id] = {"name": ce.tool_call_name, "args": ""}
                    elif isinstance(ce, ToolCallDeltaEvent):
                        if ce.tool_call_id in tool_calls:
                            tool_calls[ce.tool_call_id]["args"] += ce.delta
                    elif isinstance(ce, ToolResultStartEvent):
                        tool_results[ce.tool_call_id] = ""
                    elif isinstance(ce, ToolResultTextDeltaEvent):
                        if ce.tool_call_id in tool_results:
                            tool_results[ce.tool_call_id] += ce.delta
                    elif isinstance(ce, RequireUserConfirmEvent):
                        pending_confirm = ce

                    now = time.monotonic()
                    if now - last_update >= UPDATE_INTERVAL and (text_changed or thinking_changed):
                        panels = _build_panels(status, msg_panel, thinking_buffer, tool_calls, text_buffer, start_time, markdown)
                        live.update(Group(*panels))
                        last_update = now
                        text_changed = False
                        thinking_changed = False

        panels = _build_panels(status, msg_panel, thinking_buffer, tool_calls, text_buffer, start_time, markdown)

        final_panels = [msg_panel]
        if thinking_buffer:
            final_panels.append(Panel(Text(thinking_buffer, style="dim"), title="Thinking", border_style="green"))
        if tool_calls:
            final_panels.append(Panel(_format_tool_calls(tool_calls), title="Tool Calls", border_style="yellow"))

        elapsed = time.monotonic() - start_time
        if text_buffer:
            content = Markdown(text_buffer) if markdown else Text(text_buffer)
        else:
            content = Text("(no response)", style="dim")
        final_panels.append(Panel(content, title=f"Response ({elapsed:.1f}s)", border_style="blue"))

        live.update(Group(*final_panels))

