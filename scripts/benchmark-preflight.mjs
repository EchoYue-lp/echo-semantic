#!/usr/bin/env node

import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { computeRoute } from "../runtime/route.mjs";

const samples = Number(process.argv[2] ?? 7);
if (!Number.isInteger(samples) || samples < 2 || samples > 30)
  throw new Error("样本数必须在 2 到 30 之间");
const root = fs.mkdtempSync(resolve(tmpdir(), "echo-preflight-benchmark-"));
const original = {
  readFileSync: fs.readFileSync,
  readSync: fs.readSync,
  spawnSync: childProcess.spawnSync,
};
let counters = null;

function command(args) {
  const result = original.spawnSync(args[0], args.slice(1), {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0)
    throw new Error(`基准命令失败：${args[0]}（${result.status}）`);
  return result;
}

function summary(values) {
  const sorted = values.map((item) => item.ms).sort((a, b) => a - b);
  const percentile = (fraction) =>
    Number(sorted[Math.ceil(sorted.length * fraction) - 1].toFixed(2));
  return {
    samples: values.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    gitCallsPerSample: values.map((item) => item.gitCalls),
    readBytesPerSample: values.map((item) => item.readBytes),
  };
}

try {
  command(["git", "init", "-q"]);
  command(["git", "config", "user.email", "benchmark@example.com"]);
  command(["git", "config", "user.name", "Benchmark"]);
  fs.mkdirSync(resolve(root, ".echo-semantic/rules"), { recursive: true });
  fs.writeFileSync(resolve(root, ".echo-semantic/baseline.md"), "基准夹具\n");
  for (let index = 0; index < 1000; index += 1)
    fs.writeFileSync(
      resolve(root, `.echo-semantic/rules/rule.fixture-${index}.md`),
      `---\nid: rule.fixture-${index}\nkind: rule\n---\n夹具\n`,
    );
  command(["git", "add", "."]);
  command(["git", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"]);
  fs.writeFileSync(
    resolve(root, "large.bin"),
    Buffer.alloc(16 * 1024 * 1024, 65),
  );
  const script = resolve(
    fileURLToPath(
      new URL(
        "../skills/semantic-preflight/scripts/preflight.py",
        import.meta.url,
      ),
    ),
  );
  command([
    "python3",
    script,
    "record",
    "--root",
    root,
    "--task-id",
    "benchmark",
    "--kind",
    "bugfix",
    "--risk",
    "low",
    "--allow",
    "docs",
    "--search",
    ".",
    "--reuse-decision",
    "new",
    "--reuse",
    "基准夹具",
    "--verify",
    "定向验证",
    "--reuse-existing-boundary",
    "现有边界",
  ]);
  fs.readFileSync = (...args) => {
    const value = original.readFileSync(...args);
    if (counters)
      counters.readBytes += Buffer.isBuffer(value)
        ? value.length
        : Buffer.byteLength(value);
    return value;
  };
  fs.readSync = (...args) => {
    const count = original.readSync(...args);
    if (counters) counters.readBytes += count;
    return count;
  };
  childProcess.spawnSync = (name, args, options) => {
    if (counters && name === "git") counters.gitCalls += 1;
    return original.spawnSync(name, args, options);
  };
  syncBuiltinESMExports();
  const results = { fullRoute: [], editRoute: [], compactCheck: [] };
  for (let index = 0; index < samples; index += 1) {
    for (const observation of index % 2 ? ["edit", "full"] : ["full", "edit"]) {
      counters = { gitCalls: 0, readBytes: 0 };
      const start = performance.now();
      computeRoute(
        root,
        "codex",
        observation === "edit" ? "pre-edit" : "manual",
        {
          observation,
          probe: () => ({ detected: true, version: "fixture" }),
        },
      );
      results[observation === "edit" ? "editRoute" : "fullRoute"].push({
        ...counters,
        ms: performance.now() - start,
      });
      counters = null;
    }
    const start = performance.now();
    command([
      "python3",
      script,
      "check",
      "--root",
      root,
      "--task-id",
      "benchmark",
      "--compact",
    ]);
    results.compactCheck.push({
      ms: performance.now() - start,
      gitCalls: null,
      readBytes: null,
    });
  }
  // 对完成校验与局部盘点的 Python 文件读取单独计数。
  fs.rmSync(resolve(root, "large.bin"));
  fs.mkdirSync(resolve(root, "docs"), { recursive: true });
  fs.writeFileSync(resolve(root, "docs/target.txt"), "当前任务\n");
  const taskProgram = String.raw`
import importlib.util,json,pathlib,subprocess,sys,time
root=pathlib.Path(sys.argv[1]);plugin=pathlib.Path(sys.argv[2]);samples=int(sys.argv[3])
def load(name,relative):
    spec=importlib.util.spec_from_file_location(name,plugin/relative)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
v=load('benchmark_verifier','skills/semantic-contract/scripts/verify_semantic.py')
i=load('benchmark_inventory','skills/semantic-discover/scripts/inventory.py')
counters={'gitCalls':0,'readBytes':0}; original_run=subprocess.run;original_bytes=pathlib.Path.read_bytes;original_text=pathlib.Path.read_text;original_source=v.source_bytes
def run(*args,**kwargs):
    if args and isinstance(args[0],list) and args[0] and args[0][0]=='git':counters['gitCalls']+=1
    return original_run(*args,**kwargs)
def source(r,p):
    content=original_source(r,p);counters['readBytes']+=len(content);return content
def bytes_read(p,*args,**kwargs):
    content=original_bytes(p,*args,**kwargs)
    if p.is_relative_to(root):counters['readBytes']+=len(content)
    return content
def text_read(p,*args,**kwargs):
    text=original_text(p,*args,**kwargs)
    if p.is_relative_to(root):counters['readBytes']+=len(text.encode())
    return text
subprocess.run=run;v.source_bytes=source;i.source_bytes=source;pathlib.Path.read_bytes=bytes_read;pathlib.Path.read_text=text_read
base=original_run(['git','-C',str(root),'rev-parse','HEAD'],capture_output=True,text=True).stdout.strip()
rows=[]
for growth in [0,1000]:
    if growth:
        directory=root/'unrelated';directory.mkdir()
        for index in range(growth):(directory/f'file-{index}.bin').write_bytes(b'x'*1024)
        original_run(['git','-C',str(root),'add','unrelated'],check=True)
        original_run(['git','-C',str(root),'-c','commit.gpgsign=false','commit','-qm','unrelated fixture'],check=True,capture_output=True)
        base=original_run(['git','-C',str(root),'rev-parse','HEAD'],capture_output=True,text=True).stdout.strip()
        state=json.loads((root/'.echo-semantic/preflight.json').read_text());state['baseRevision']=base;(root/'.echo-semantic/preflight.json').write_text(json.dumps(state))
    for phase in ['completion','localInventory']:
        for _ in range(samples):
            counters.update(gitCalls=0,readBytes=0);start=time.perf_counter()
            if phase=='completion':
                errors,report=v.validate_task(root,base,'benchmark')
                if errors:raise RuntimeError(errors)
            else:i.scan(root,False,['docs/target.txt'])
            rows.append({'phase':phase,'unrelatedFiles':growth,'ms':round((time.perf_counter()-start)*1000,2),**counters})
print(json.dumps(rows))
`;
  const taskRows = JSON.parse(
    command([
      "uv",
      "run",
      "--with",
      "PyYAML>=6.0,<7",
      "python",
      "-c",
      taskProgram,
      root,
      resolve(import.meta.dirname, ".."),
      String(samples),
    ]).stdout,
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        fixture: { semanticObjects: 1000, dirtyBytes: 16 * 1024 * 1024 },
        taskStages: Object.fromEntries(
          ["completion", "localInventory"].flatMap((phase) =>
            [0, 1000].map((growth) => [
              `${phase}-${growth}-unrelated`,
              summary(
                taskRows.filter(
                  (row) => row.phase === phase && row.unrelatedFiles === growth,
                ),
              ),
            ]),
          ),
        ),
        limitations:
          "临时夹具；路由阶段注入宿主探测，不包含真实 CLI、助手调查、保护差异和宿主 Hook 调度耗时；compactCheck 包含 Python 进程启动，未采集 compactCheck 子进程读文件计数；taskStages 的字节统计覆盖源码与 Path 读取，不含运行态描述符读取，阶段计时不含 Python 启动。",
        ...Object.fromEntries(
          Object.entries(results).map(([name, values]) => [
            name,
            summary(values),
          ]),
        ),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  fs.readFileSync = original.readFileSync;
  fs.readSync = original.readSync;
  childProcess.spawnSync = original.spawnSync;
  syncBuiltinESMExports();
  fs.rmSync(root, { recursive: true, force: true });
}
