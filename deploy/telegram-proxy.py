"""Authenticated TLS CONNECT relay restricted to Telegram's HTTPS endpoint."""
import asyncio
import hmac
import os
from pathlib import Path
import socket
import ssl

active = 0
LIMIT = 12


def credentials():
    root = Path(os.environ["CREDENTIALS_DIRECTORY"])
    return root, root.joinpath("auth").read_text().strip().encode("ascii")


def permitted(head, secret):
    lines = head.split(b"\r\n")
    if lines[0] != b"CONNECT api.telegram.org:443 HTTP/1.1":
        return False
    auth = [line.split(b":", 1)[1].strip() for line in lines[1:] if line.lower().startswith(b"proxy-authorization:")]
    return len(auth) == 1 and hmac.compare_digest(auth[0], secret)


async def pipe(reader, writer):
    total = 0
    while chunk := await asyncio.wait_for(reader.read(16384), 30):
        total += len(chunk)
        if total > 2 * 1024 * 1024:
            raise ValueError("tunnel size limit")
        writer.write(chunk)
        await writer.drain()


async def handle(reader, writer, secret):
    global active
    if active >= LIMIT:
        writer.close()
        return
    active += 1
    upstream = None
    tasks = []
    try:
        head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 5)
        if len(head) > 8192 or not permitted(head, secret):
            writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            await writer.drain()
            return
        incoming, upstream = await asyncio.wait_for(asyncio.open_connection("api.telegram.org", 443, family=socket.AF_INET6), 8)
        writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        await writer.drain()
        tasks = [asyncio.create_task(pipe(reader, upstream)), asyncio.create_task(pipe(incoming, writer))]
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED, timeout=45)
    except (OSError, ValueError, asyncio.TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
        pass  # No request headers, credentials or tunneled traffic are logged.
    finally:
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        for stream in (upstream, writer):
            if stream:
                stream.close()
                try:
                    await asyncio.wait_for(stream.wait_closed(), 2)
                except (OSError, asyncio.TimeoutError):
                    pass
        active -= 1


async def main():
    root, secret = credentials()
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(root / "cert", root / "key")
    server = await asyncio.start_server(lambda r, w: handle(r, w, secret), "0.0.0.0", 55434, ssl=context, ssl_handshake_timeout=5, limit=8192)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
