import { build } from "vite";
import { gzipSync } from "node:zlib";

// Build in memory using production settings; no files are written to dist.
const result = await build({ logLevel: "silent", build: { write: false } });
const outputs = (Array.isArray(result) ? result : [result]).flatMap(result => result.output);
const chunks = outputs.filter(item => item.type === "chunk");
const byName = new Map(chunks.map(chunk => [chunk.fileName, chunk]));
const initial = new Set();
function visit(name) {
  if (initial.has(name)) return;
  initial.add(name);
  for (const dependency of byName.get(name)?.imports ?? []) visit(dependency);
}
for (const chunk of chunks.filter(chunk => chunk.isEntry)) visit(chunk.fileName);
const bytes = code => Buffer.byteLength(code.replace(/\n?\/\/# sourceMappingURL=.*(?:\n|$)/g, ""));
const measured = chunks.map(chunk => ({ file: chunk.fileName, initial: initial.has(chunk.fileName),
  bytes: bytes(chunk.code), gzip: gzipSync(chunk.code.replace(/\n?\/\/# sourceMappingURL=.*(?:\n|$)/g, "")).length }));
const modules = chunks.flatMap(chunk => Object.entries(chunk.modules).map(([name,info]) => ({
  name: name.replaceAll("\\", "/").split("/CONMEBOL/").pop(), renderedBytes: info.renderedLength ?? 0,
}))).sort((a,b) => b.renderedBytes-a.renderedBytes);
console.log(JSON.stringify({ chunks: measured, initialBytes: measured.filter(c=>c.initial).reduce((n,c)=>n+c.bytes,0),
  initialGzip: measured.filter(c=>c.initial).reduce((n,c)=>n+c.gzip,0),
  totalBytes: measured.reduce((n,c)=>n+c.bytes,0), largestModules: modules.slice(0,25) },null,2));
