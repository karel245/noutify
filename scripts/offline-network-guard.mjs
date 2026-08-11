import dns from "node:dns";
import dgram from "node:dgram";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";

function denyNetwork() {
  const error = new Error("network access is disabled for the Noutify offline smoke");
  error.code = "NOUTIFY_OFFLINE_NETWORK_DISABLED";
  throw error;
}

globalThis.fetch = denyNetwork;
if (typeof globalThis.WebSocket === "function") globalThis.WebSocket = denyNetwork;
if (typeof globalThis.EventSource === "function") globalThis.EventSource = denyNetwork;

for (const client of [http, https]) {
  client.request = denyNetwork;
  client.get = denyNetwork;
}
http2.connect = denyNetwork;
net.connect = denyNetwork;
net.createConnection = denyNetwork;
net.Socket.prototype.connect = denyNetwork;
tls.connect = denyNetwork;
dgram.createSocket = denyNetwork;

const dnsMethods = [
  "lookup",
  "lookupService",
  "resolve",
  "resolve4",
  "resolve6",
  "resolveAny",
  "resolveCaa",
  "resolveCname",
  "resolveMx",
  "resolveNaptr",
  "resolveNs",
  "resolvePtr",
  "resolveSoa",
  "resolveSrv",
  "resolveTxt",
  "reverse",
];
for (const method of dnsMethods) {
  dns[method] = denyNetwork;
  if (typeof dns.promises?.[method] === "function") {
    dns.promises[method] = denyNetwork;
  }
}

syncBuiltinESMExports();
