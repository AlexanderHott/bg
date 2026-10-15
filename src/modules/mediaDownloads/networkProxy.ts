import { lookup } from "node:dns/promises";
import { createServer, request } from "node:http";
import { BlockList, connect, isIP } from "node:net";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
blocked.addSubnet("3fff::", 20, "ipv6");

export function isPublicAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

async function publicAddress(hostname: string) {
  const addresses = await lookup(hostname.replace(/^\[|\]$/g, ""), { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
    throw new Error("Private network destinations are not allowed.");
  return addresses[0]!;
}

/** Pins each connection to a validated public address, including redirects made by yt-dlp. */
export async function startMediaProxy() {
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const url = new URL(incoming.url ?? "");
      if (
        url.protocol !== "http:" ||
        url.username ||
        url.password ||
        (url.port && url.port !== "80")
      )
        throw new Error("Unsupported destination.");
      const target = await publicAddress(url.hostname);
      const headers = {
        ...Object.fromEntries(
          Object.entries(incoming.headers).filter(
            ([name]) => !["proxy-authorization", "proxy-connection"].includes(name),
          ),
        ),
        host: url.host,
      };
      const upstream = request(
        {
          hostname: target.address,
          family: target.family,
          port: 80,
          method: incoming.method,
          path: url.pathname + url.search,
          headers,
        },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        },
      );
      upstream.setTimeout(30_000, () => upstream.destroy());
      upstream.on("error", () => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end();
      });
      outgoing.on("close", () => upstream.destroy());
      incoming.pipe(upstream);
    })().catch(() => {
      outgoing.writeHead(403);
      outgoing.end("Destination not allowed");
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("connect", (incoming, client, head) => {
    void (async () => {
      const url = new URL(`https://${incoming.url}`);
      if (url.username || url.password || (url.port && url.port !== "443") || url.pathname !== "/")
        throw new Error("Unsupported destination.");
      const target = await publicAddress(url.hostname);
      if (client.destroyed) return;
      const upstream = connect({ host: target.address, family: target.family, port: 443 });
      sockets.add(upstream);
      upstream.on("close", () => sockets.delete(upstream));
      upstream.setTimeout(30_000, () => upstream.destroy());
      upstream.on("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
      client.on("close", () => upstream.destroy());
    })().catch(() => client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"));
  });
  server.requestTimeout = 30_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start media proxy.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
