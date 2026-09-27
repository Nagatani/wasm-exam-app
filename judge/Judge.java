import com.google.gson.Gson;
import com.google.gson.JsonSyntaxException;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/**
 * Single-file HTTP judge for student Java and C submissions. Runs as the only
 * process in the `judge` Docker container (see Dockerfile / docker-compose.yml)
 * — compilation and execution never touch the host, and the container is the
 * sandbox boundary (no caps, read-only rootfs, tmpfs workdir, pids/mem caps,
 * no outbound network via the `internal` compose network).
 *
 * Protocol (called only by the app's own Express server, never a browser):
 *   POST /run
 *     { "language": "JAVA" | "C" | "JS" | "TS" | "PYTHON",   // default "JAVA"
 *       "code": "<Main.java or main.c source>",
 *       "tests": [ { "id": "...", "stdin": "...",
 *                    "timeLimitMs": 2000, "memoryLimitMb": 256 } ] }
 *   200 { "compile": { "ok": bool, "stderr": "..." },
 *         "results": [ { "id", "stdout", "stderr", "exitCode",
 *                        "timedOut": bool, "oom": bool, "timeMs": long } ] }
 *   timeMs = wall-clock from process start to exit (for Java this includes
 *   JVM startup, typically a few hundred ms).
 *
 * The verdict (AC/WA/CE) is NOT computed here — the app server re-derives it
 * from these raw outcomes via its own judgeSubmission(). This service only
 * reports what the program printed and how it exited.
 *
 * Languages (2026-09-26 — "本採点のサーバー実行化"): besides Java, the judge
 * grades the languages whose day-to-day preview runs in the student's browser
 * (C / JS / TS / Python), using the SAME runtimes as the browser so a program
 * can't behave differently here than in the preview:
 *   - C: clang 16 (the browser's @wasmer/sdk clang is 16.0.0) compiling to
 *     wasm32-wasi against wasi-libc, run with Node's WASI (runner/runWasm.mjs)
 *     — same type sizes (long = 4 bytes), same libc, same -O0, same
 *     --max-memory cap.
 *   - JS / TS / Python: delegated to runner/run.mjs (Node), which uses the
 *     code shared with the browser in runner/shared/ (stdin helpers, output
 *     formatting, sucrase TS transform, Pyodide of the same version).
 * For these four languages the request's per-test timeLimitMs/memoryLimitMb
 * are ignored: the limits come from runner/shared/limits.js, read once at
 * startup, which the browser uses too.
  */
public final class Judge {

  private static final Gson GSON = new Gson();

  private static final int PORT =
      Integer.parseInt(System.getenv().getOrDefault("JUDGE_PORT", "8080"));
  // How many /run requests may compile+execute at once. The app server also
  // bounds this from its side; this is the in-container backstop.
  private static final int MAX_CONCURRENT_RUNS =
      Integer.parseInt(System.getenv().getOrDefault("JUDGE_MAX_CONCURRENT", "2"));
  private static final long COMPILE_TIMEOUT_MS = 25_000;
  private static final int MAX_CODE_BYTES = 200_000;
  private static final int MAX_REQUEST_BYTES = 2_000_000;
  private static final int MAX_STREAM_BYTES = 64 * 1024;
  private static final long DEFAULT_TIME_LIMIT_MS = 2_000;
  private static final long MAX_TIME_LIMIT_MS = 15_000;
  private static final long DEFAULT_MEM_LIMIT_MB = 256;
  private static final long MAX_MEM_LIMIT_MB = 512;

  // Node runner (JS/TS/Python/C-wasm) and the wasm32-wasi C toolchain.
  private static final Path RUNNER_DIR =
      Path.of(System.getenv().getOrDefault("JUDGE_RUNNER_DIR", "/app/runner"));
  private static final String NODE = System.getenv().getOrDefault("JUDGE_NODE", "/usr/local/bin/node");
  private static final String CLANG =
      System.getenv().getOrDefault("JUDGE_CLANG", "/usr/lib/llvm-16/bin/clang");
  private static final String WASI_SYSROOT =
      System.getenv().getOrDefault("JUDGE_WASI_SYSROOT", "/usr");
  // First Pyodide load inside run.mjs (mirrors its PY_LOAD_TIMEOUT_MS) plus
  // process startup — added on top of the per-test limits for the overall
  // wall-clock cap on one run.mjs invocation.
  private static final long NODE_RUNNER_BASE_TIMEOUT_MS = 95_000;
  // Grace for Node startup + wasm instantiation on top of the C time limit.
  private static final long C_RUN_GRACE_MS = 300;

  private static SharedLimits SHARED;

  private static final Semaphore RUN_SLOTS = new Semaphore(MAX_CONCURRENT_RUNS, true);
  private static final Path WORK_ROOT = Path.of(System.getenv().getOrDefault("JUDGE_WORK", "/work"));

  private Judge() {}

  public static void main(String[] args) throws IOException, InterruptedException {
    Files.createDirectories(WORK_ROOT);
    SHARED = loadSharedLimits();
    HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", PORT), 0);
    server.setExecutor(Executors.newFixedThreadPool(Math.max(4, MAX_CONCURRENT_RUNS + 2)));
    server.createContext("/health", ex -> writeJson(ex, 200, "{\"ok\":true}"));
    server.createContext("/run", Judge::handleRun);
    server.start();
    System.out.println("judge listening on :" + PORT
        + " (maxConcurrent=" + MAX_CONCURRENT_RUNS + ", limits=" + GSON.toJson(SHARED) + ")");
  }

  // ---- request / response DTOs (Gson-mapped) --------------------------------

  // runner/shared/limits.js, as JSON (see loadSharedLimits).
  private static final class SharedLimits {
    java.util.Map<String, Long> timeLimitMs;
    List<String> cFlags;
  }

  // The node runner's request (run.mjs) — tests without per-test limits.
  private static final class NodeRunRequest {
    final String language;
    final String code;
    final List<NodeTest> tests;

    NodeRunRequest(String language, String code, List<NodeTest> tests) {
      this.language = language;
      this.code = code;
      this.tests = tests;
    }
  }

  private static final class NodeTest {
    final String id;
    final String stdin;

    NodeTest(String id, String stdin) {
      this.id = id;
      this.stdin = stdin;
    }
  }

  private static final class RunRequest {
    String language; // "JAVA" (default) / "C" / "JS" / "TS" / "PYTHON"
    String code;
    List<TestSpec> tests;
  }

  private static final class TestSpec {
    String id;
    String stdin;
    long timeLimitMs;
    long memoryLimitMb;
  }

  private static final class CompileInfo {
    final boolean ok;
    final String stderr;

    CompileInfo(boolean ok, String stderr) {
      this.ok = ok;
      this.stderr = stderr;
    }
  }

  private static final class TestOutcome {
    final String id;
    final String stdout;
    final String stderr;
    final Integer exitCode;
    final boolean timedOut;
    final boolean oom;
    final long timeMs;

    TestOutcome(String id, String stdout, String stderr, Integer exitCode,
        boolean timedOut, boolean oom, long timeMs) {
      this.id = id;
      this.stdout = stdout;
      this.stderr = stderr;
      this.exitCode = exitCode;
      this.timedOut = timedOut;
      this.oom = oom;
      this.timeMs = timeMs;
    }
  }

  private static final class RunResponse {
    final CompileInfo compile;
    final List<TestOutcome> results;

    RunResponse(CompileInfo compile, List<TestOutcome> results) {
      this.compile = compile;
      this.results = results;
    }
  }

  // ---- /run ---------------------------------------------------------------

  private static void handleRun(HttpExchange ex) throws IOException {
    try {
      if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
        writeJson(ex, 405, "{\"error\":\"method_not_allowed\"}");
        return;
      }

      byte[] body = readBody(ex.getRequestBody());
      if (body == null) {
        writeJson(ex, 413, "{\"error\":\"request_too_large\"}");
        return;
      }

      RunRequest req;
      try {
        req = GSON.fromJson(new String(body, StandardCharsets.UTF_8), RunRequest.class);
      } catch (JsonSyntaxException e) {
        writeJson(ex, 400, "{\"error\":\"invalid_json\"}");
        return;
      }
      if (req == null || req.code == null || req.tests == null) {
        writeJson(ex, 400, "{\"error\":\"missing_fields\"}");
        return;
      }
      if (req.code.getBytes(StandardCharsets.UTF_8).length > MAX_CODE_BYTES) {
        writeJson(ex, 400, "{\"error\":\"code_too_large\"}");
        return;
      }

      if (!RUN_SLOTS.tryAcquire(30, TimeUnit.SECONDS)) {
        writeJson(ex, 503, "{\"error\":\"judge_busy\"}");
        return;
      }
      try {
        RunResponse response = compileAndRun(req);
        writeJson(ex, 200, GSON.toJson(response));
      } finally {
        RUN_SLOTS.release();
      }
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      writeJson(ex, 503, "{\"error\":\"interrupted\"}");
    } catch (Exception e) {
      writeJson(ex, 500, "{\"error\":" + GSON.toJson(String.valueOf(e.getMessage())) + "}");
    }
  }

  private static String normalizeLanguage(String raw) {
    if (raw == null) return "JAVA";
    String upper = raw.trim().toUpperCase(Locale.ROOT);
    return switch (upper) {
      case "C", "JS", "TS", "PYTHON" -> upper;
      default -> "JAVA";
    };
  }

  // Reads runner/shared/limits.js through Node once at startup, so the time
  // limits and C flags have exactly one definition (shared with the browser).
  private static SharedLimits loadSharedLimits() throws IOException, InterruptedException {
    String script = "import(" + GSON.toJson(RUNNER_DIR.resolve("shared/limits.js").toUri().toString()) + ")"
        + ".then(m => process.stdout.write(JSON.stringify({ timeLimitMs: m.RUN_TIME_LIMIT_MS, cFlags: m.C_COMPILE_FLAGS })))";
    Process p = new ProcessBuilder(NODE, "--input-type=module", "-e", script).redirectErrorStream(true).start();
    String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    if (!p.waitFor(20, TimeUnit.SECONDS) || p.exitValue() != 0) {
      throw new IllegalStateException("could not read runner/shared/limits.js: " + out);
    }
    return GSON.fromJson(out, SharedLimits.class);
  }

  private static RunResponse compileAndRun(RunRequest req) throws IOException, InterruptedException {
    String language = normalizeLanguage(req.language);
    Path jobDir = Files.createTempDirectory(WORK_ROOT, "job-");
    try {
      if ("JS".equals(language) || "TS".equals(language) || "PYTHON".equals(language)) {
        return runNodeRunner(jobDir, language, req);
      }
      if ("C".equals(language)) {
        Path srcDir = Files.createDirectories(jobDir.resolve("src"));
        Path mainC = srcDir.resolve("main.c");
        Files.writeString(mainC, req.code);
        Path binary = jobDir.resolve("main.wasm");

        CompileInfo compile = compileC(mainC, binary, srcDir);
        if (!compile.ok) {
          return new RunResponse(compile, List.of());
        }

        List<TestOutcome> outcomes = new ArrayList<>();
        for (TestSpec test : req.tests) {
          outcomes.add(runOne(jobDir, language, binary, test));
        }
        return new RunResponse(compile, outcomes);
      }

      Path srcDir = Files.createDirectories(jobDir.resolve("src"));
      Path classesDir = Files.createDirectories(jobDir.resolve("classes"));
      Path mainJava = srcDir.resolve("Main.java");
      Files.writeString(mainJava, req.code);

      CompileInfo compile = compileJava(mainJava, classesDir);
      if (!compile.ok) {
        return new RunResponse(compile, List.of());
      }

      List<TestOutcome> outcomes = new ArrayList<>();
      for (TestSpec test : req.tests) {
        outcomes.add(runOne(jobDir, language, classesDir, test));
      }
      return new RunResponse(compile, outcomes);
    } finally {
      deleteRecursively(jobDir);
    }
  }

  private static CompileInfo compileJava(Path mainJava, Path classesDir)
      throws InterruptedException {
    JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
    if (compiler == null) {
      return new CompileInfo(false, "no system Java compiler available");
    }

    DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
    // Run the in-process compiler on a worker thread so a pathological source
    // can't wedge the request thread forever.
    final CompileInfo[] holder = new CompileInfo[1];
    Thread worker = new Thread(() -> {
      try (StandardJavaFileManager fm =
               compiler.getStandardFileManager(diagnostics, Locale.US, StandardCharsets.UTF_8)) {
        Iterable<? extends JavaFileObject> units =
            fm.getJavaFileObjectsFromPaths(List.of(mainJava));
        List<String> options = List.of(
            "--release", "24",
            "--enable-preview",
            "-encoding", "UTF-8",
            "-d", classesDir.toString());
        StringWriterSink sink = new StringWriterSink();
        boolean ok = compiler.getTask(sink, fm, diagnostics, options, null, units).call();
        StringBuilder sb = new StringBuilder();
        for (Diagnostic<? extends JavaFileObject> d : diagnostics.getDiagnostics()) {
          // On a successful compile, drop the informational "uses preview
          // features" / "Recompile with -Xlint" notes — they're just noise to
          // a student whose code built fine.
          if (ok && d.getKind() == Diagnostic.Kind.NOTE) {
            continue;
          }
          sb.append(d.toString()).append('\n');
        }
        if (!ok) {
          sb.append(sink.toString());
        }
        holder[0] = new CompileInfo(ok, sb.toString().trim());
      } catch (Exception e) {
        holder[0] = new CompileInfo(false, String.valueOf(e.getMessage()));
      }
    }, "javac");
    worker.setDaemon(true);
    worker.start();
    worker.join(COMPILE_TIMEOUT_MS);
    if (worker.isAlive()) {
      worker.interrupt();
      return new CompileInfo(false, "compilation timed out");
    }
    return holder[0] != null ? holder[0] : new CompileInfo(false, "compilation failed");
  }

  // C → wasm32-wasi with clang 16 + wasi-libc: the same target, compiler
  // major version, optimisation level (-O0, clang's default) and flags
  // (runner/shared/limits.js C_COMPILE_FLAGS: the --max-memory cap) as the
  // browser's @wasmer/sdk clang, so type sizes, libc behaviour and memory
  // limits match the preview. Diagnostics read `main.c:LINE:COL: ...`.
  private static CompileInfo compileC(Path mainC, Path binary, Path srcDir)
      throws IOException, InterruptedException {
    List<String> cmd = new ArrayList<>(List.of(
        CLANG, "--target=wasm32-wasi", "--sysroot=" + WASI_SYSROOT,
        "-o", binary.toString(),
        mainC.getFileName().toString()));
    cmd.addAll(SHARED.cFlags);
    ProcessBuilder pb = new ProcessBuilder(cmd);
    pb.directory(srcDir.toFile());
    pb.environment().clear();
    pb.environment().put("PATH", "/usr/lib/llvm-16/bin:/usr/bin:/bin");
    pb.environment().put("LANG", "C.UTF-8");

    Process process = pb.start();
    process.getOutputStream().close();

    StreamDrainer outDrainer = new StreamDrainer(process.getInputStream());
    StreamDrainer errDrainer = new StreamDrainer(process.getErrorStream());
    outDrainer.start();
    errDrainer.start();

    boolean exited = process.waitFor(COMPILE_TIMEOUT_MS, TimeUnit.MILLISECONDS);
    if (!exited) {
      process.destroyForcibly();
      process.waitFor(2, TimeUnit.SECONDS);
      return new CompileInfo(false, "compilation timed out");
    }
    outDrainer.join(1_000);
    errDrainer.join(1_000);

    String stderr = errDrainer.text();
    if (process.exitValue() != 0) {
      return new CompileInfo(false, stderr.isBlank() ? "clang exited with status " + process.exitValue() : stderr);
    }
    return new CompileInfo(true, stderr.trim());
  }

  // JS / TS / Python: one run.mjs process per request (it runs every test
  // itself, with the shared per-test limits and browser-identical worker
  // lifecycle) and answers in this service's own response shape.
  private static RunResponse runNodeRunner(Path jobDir, String language, RunRequest req)
      throws IOException, InterruptedException {
    List<NodeTest> tests = new ArrayList<>();
    for (TestSpec t : req.tests) tests.add(new NodeTest(t.id, t.stdin != null ? t.stdin : ""));
    long perTest = SHARED.timeLimitMs.getOrDefault(language, 10_000L) + 2_000;
    long overallMs = NODE_RUNNER_BASE_TIMEOUT_MS + perTest * tests.size();

    ProcessBuilder pb = new ProcessBuilder(NODE, "--no-warnings", RUNNER_DIR.resolve("run.mjs").toString());
    pb.directory(jobDir.toFile());
    pb.environment().clear();
    pb.environment().put("PATH", "/usr/local/bin:/usr/bin:/bin");
    pb.environment().put("HOME", jobDir.toString());
    pb.environment().put("LANG", "C.UTF-8");
    Process process = pb.start();

    byte[] input = GSON.toJson(new NodeRunRequest(language, req.code, tests)).getBytes(StandardCharsets.UTF_8);
    Thread stdinPump = new Thread(() -> {
      try (OutputStream os = process.getOutputStream()) {
        os.write(input);
      } catch (IOException ignored) {
        // runner died early; reported below
      }
    }, "runner-stdin");
    stdinPump.setDaemon(true);
    stdinPump.start();

    // The response carries every test's output (capped per stream below by
    // capStreams), so allow far more than one stream's worth here.
    StreamDrainer outDrainer = new StreamDrainer(process.getInputStream(), MAX_STREAM_BYTES * (tests.size() + 2) * 2);
    StreamDrainer errDrainer = new StreamDrainer(process.getErrorStream());
    outDrainer.start();
    errDrainer.start();

    boolean exited = process.waitFor(overallMs, TimeUnit.MILLISECONDS);
    if (!exited) {
      process.descendants().forEach(ProcessHandle::destroyForcibly);
      process.destroyForcibly();
      process.waitFor(2, TimeUnit.SECONDS);
      throw new IllegalStateException("runner timed out");
    }
    outDrainer.join(2_000);
    errDrainer.join(1_000);
    if (process.exitValue() != 0) {
      throw new IllegalStateException("runner failed: " + errDrainer.text());
    }
    RunResponse response = GSON.fromJson(outDrainer.text(), RunResponse.class);
    return capStreams(response);
  }

  // Apply this service's usual per-stream cap to a runner response.
  private static RunResponse capStreams(RunResponse r) {
    List<TestOutcome> capped = new ArrayList<>();
    for (TestOutcome o : r.results) {
      capped.add(new TestOutcome(o.id, cap(o.stdout), cap(o.stderr), o.exitCode, o.timedOut, o.oom, o.timeMs));
    }
    return new RunResponse(r.compile, capped);
  }

  private static String cap(String s) {
    if (s == null) return "";
    byte[] b = s.getBytes(StandardCharsets.UTF_8);
    return b.length <= MAX_STREAM_BYTES ? s : new String(b, 0, MAX_STREAM_BYTES, StandardCharsets.UTF_8);
  }

  private static TestOutcome runOne(Path jobDir, String language, Path artifact, TestSpec test)
      throws IOException, InterruptedException {
    boolean isC = "C".equals(language);
    // C uses the browser's fixed limit (shared/limits.js), not the request's.
    long timeLimitMs = isC
        ? SHARED.timeLimitMs.getOrDefault("C", 10_000L)
        : clamp(test.timeLimitMs, DEFAULT_TIME_LIMIT_MS, MAX_TIME_LIMIT_MS);
    long memLimitMb = clamp(test.memoryLimitMb, DEFAULT_MEM_LIMIT_MB, MAX_MEM_LIMIT_MB);
    long cpuSeconds = (timeLimitMs / 1000) + 2;
    String stdin = test.stdin != null ? test.stdin : "";

    // ulimit gives cheap secondary guards (file size, CPU seconds, and for C
    // also address space) on top of the wall-clock kill below; `exec`
    // replaces the shell so the timeout targets the program directly. Only
    // POSIX-portable options are used (the container's /bin/sh is dash — no
    // `ulimit -u`); fork bombs are contained by the container-level
    // pids_limit instead.
    // (C's memory cap is the wasm --max-memory, not ulimit -v: Node itself
    // needs far more address space than the program.)
    String shell = "ulimit -f 32768; ulimit -t " + cpuSeconds + "; exec \"$@\"";
    List<String> cmd = isC
        ? List.of("/bin/sh", "-c", shell, "sh", NODE, "--no-warnings",
            RUNNER_DIR.resolve("runWasm.mjs").toString(), artifact.toString())
        : List.of(
            "/bin/sh", "-c", shell, "sh",
            "java",
            "--enable-preview",
            "-XX:+UseSerialGC",
            "-XX:ActiveProcessorCount=1",
            "-XX:-UsePerfData",
            "-Xss16m",
            "-Xmx" + memLimitMb + "m",
            "-cp", artifact.toString(),
            "Main");

    ProcessBuilder pb = new ProcessBuilder(cmd);
    pb.directory(jobDir.toFile());
    pb.environment().clear();
    pb.environment().put("PATH", "/opt/java/openjdk/bin:/usr/local/bin:/usr/bin:/bin");
    pb.environment().put("HOME", jobDir.toString());
    pb.environment().put("LANG", "C.UTF-8");

    Process process = pb.start();
    long startedNanos = System.nanoTime();

    Thread stdinPump = new Thread(() -> {
      try (OutputStream os = process.getOutputStream()) {
        os.write(stdin.getBytes(StandardCharsets.UTF_8));
        os.flush();
      } catch (IOException ignored) {
        // program may not consume all stdin — that's fine
      }
    }, "stdin");
    stdinPump.setDaemon(true);
    stdinPump.start();

    StreamDrainer outDrainer = new StreamDrainer(process.getInputStream());
    StreamDrainer errDrainer = new StreamDrainer(process.getErrorStream());
    outDrainer.start();
    errDrainer.start();

    boolean exited = process.waitFor(timeLimitMs + (isC ? C_RUN_GRACE_MS : 500), TimeUnit.MILLISECONDS);
    long timeMs = (System.nanoTime() - startedNanos) / 1_000_000;
    boolean timedOut = false;
    if (!exited) {
      timedOut = true;
      process.descendants().forEach(ProcessHandle::destroyForcibly);
      process.destroyForcibly();
      process.waitFor(2, TimeUnit.SECONDS);
    }

    outDrainer.join(1_000);
    errDrainer.join(1_000);

    Integer exitCode = null;
    try {
      exitCode = process.exitValue();
    } catch (IllegalThreadStateException ignored) {
      // still not dead; leave exitCode null
    }

    String stdout = outDrainer.text();
    String stderr = errDrainer.text();
    // C: no reliable OOM signal (an allocation past --max-memory just fails
    // inside the program, as in the browser) — always false. Java: -Xmx.
    boolean oom = !isC
        && (stderr.contains("OutOfMemoryError") || stderr.contains("java.lang.OutOfMemoryError"));

    return new TestOutcome(test.id, stdout, stderr, exitCode, timedOut, oom, timeMs);
  }

  // ---- helpers ----------------------------------------------------------

  private static long clamp(long value, long fallbackWhenNonPositive, long max) {
    long v = value <= 0 ? fallbackWhenNonPositive : value;
    return Math.min(v, max);
  }

  private static byte[] readBody(InputStream in) throws IOException {
    ByteArrayOutputStream buf = new ByteArrayOutputStream();
    byte[] chunk = new byte[8192];
    int n;
    while ((n = in.read(chunk)) != -1) {
      buf.write(chunk, 0, n);
      if (buf.size() > MAX_REQUEST_BYTES) {
        return null;
      }
    }
    return buf.toByteArray();
  }

  private static void writeJson(HttpExchange ex, int status, String json) throws IOException {
    byte[] out = json.getBytes(StandardCharsets.UTF_8);
    ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
    ex.sendResponseHeaders(status, out.length);
    try (OutputStream os = ex.getResponseBody()) {
      os.write(out);
    }
  }

  private static void deleteRecursively(Path root) {
    try {
      if (!Files.exists(root)) {
        return;
      }
      try (var walk = Files.walk(root)) {
        walk.sorted(Comparator.reverseOrder()).forEach(p -> {
          try {
            Files.deleteIfExists(p);
          } catch (IOException ignored) {
            // best effort — tmpfs job dir, container restart clears it anyway
          }
        });
      }
    } catch (IOException ignored) {
      // best effort
    }
  }

  /** Reads a process stream fully (up to a cap) on its own thread. */
  private static final class StreamDrainer extends Thread {
    private final InputStream in;
    private final int maxBytes;
    private final ByteArrayOutputStream buf = new ByteArrayOutputStream();
    private volatile boolean truncated = false;

    StreamDrainer(InputStream in) {
      this(in, MAX_STREAM_BYTES);
    }

    StreamDrainer(InputStream in, int maxBytes) {
      this.in = in;
      this.maxBytes = maxBytes;
      setDaemon(true);
    }

    @Override
    public void run() {
      byte[] chunk = new byte[8192];
      int n;
      try {
        while ((n = in.read(chunk)) != -1) {
          int room = maxBytes - buf.size();
          if (room <= 0) {
            truncated = true;
            // keep draining so the process isn't blocked on a full pipe
            continue;
          }
          buf.write(chunk, 0, Math.min(n, room));
          if (n > room) {
            truncated = true;
          }
        }
      } catch (IOException ignored) {
        // stream closed / process killed
      }
    }

    String text() {
      String s = buf.toString(StandardCharsets.UTF_8);
      return truncated ? s + "\n...[出力が長いため以降を省略しました]" : s;
    }
  }

  /** java.io.Writer sink backed by a StringBuilder (avoids importing StringWriter twice). */
  private static final class StringWriterSink extends java.io.Writer {
    private final StringBuilder sb = new StringBuilder();

    @Override
    public void write(char[] cbuf, int off, int len) {
      sb.append(cbuf, off, len);
    }

    @Override
    public void flush() {}

    @Override
    public void close() {}

    @Override
    public String toString() {
      return sb.toString();
    }
  }
}
