import asyncio

from novae.agents import get_agent


async def main() -> None:
    agent = get_agent("novae-coder")
    reply = await agent.reply("你好")
    print(reply.get_text_content())


if __name__ == "__main__":
    asyncio.run(main())
