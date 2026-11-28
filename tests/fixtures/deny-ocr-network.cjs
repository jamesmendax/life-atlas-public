const http = require("node:http");
const https = require("node:https");
const http2 = require("node:http2");
const net = require("node:net");
const tls = require("node:tls");
const dgram = require("node:dgram");

function denyNetwork() { throw new Error("The OCR test process cannot access the network"); }

globalThis.fetch = denyNetwork;
http.request = http.get = https.request = https.get = http2.connect = denyNetwork;
net.createConnection = net.connect = net.Socket.prototype.connect = tls.connect = dgram.createSocket = denyNetwork;
