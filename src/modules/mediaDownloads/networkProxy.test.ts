import { request } from "node:http";

import { describe, expect, test } from "vite-plus/test";

import { isPublicAddress, startMediaProxy } from "./networkProxy";

describe("downloader network access", () => {
  test("rejects local, private, metadata, mapped, and transition addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "224.1.1.1",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
      "2002:7f00:1::",
      "2001:db8::1",
      "not-an-ip",
    ])
      expect(isPublicAddress(address), address).toBe(false);
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });
  test("blocks HTTP and HTTPS attempts to internal services", async () => {
    const proxy = await startMediaProxy();
    try {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(proxy.url, { path: "http://127.0.0.1/", method: "GET" }, (response) => {
          response.resume();
          resolve(response.statusCode);
        });
        req.on("error", reject);
        req.end();
      });
      expect(status).toBe(403);
      const tunnelStatus = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(proxy.url, { path: "169.254.169.254:443", method: "CONNECT" });
        req.on("connect", (response, socket) => {
          socket.destroy();
          resolve(response.statusCode);
        });
        req.on("error", reject);
        req.end();
      });
      expect(tunnelStatus).toBe(403);
    } finally {
      await proxy.close();
    }
  });
});
