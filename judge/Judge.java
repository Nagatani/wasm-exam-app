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
 *     { "language": "JAVA" | "C",   // optional, defaults to "JAVA"
 *       "code": "<Main.java or main.c source>",
 *       "tests": [ { "id": "...", "stdin": "...",
 *                    "timeLimitMs": 2000, "memoryLimitMb": 256 } ] }
 *   200 { "compile": { "ok": bool, "stderr": "..." },
 *         "results": [ { "id", "stdout", "stderr", "exitCode",
 *                        "timedOut": bool, "oom": bool } ] }
 *
 * The verdict (AC/WA/CE) is NOT computed here — the app server re-derives it
 * from these raw outcomes via its own judgeSubmission(). This service only
 * reports what the program printed and how it exited.
 *
 * C support (2026-09) is deliberately narrow in scope: as of this writing the
 * app server only calls it for Java's day-to-day exam flow plus a
 * teacher-triggered *regrade* of already-submitted C code (see
 * server/src/routes/tasks.ts `/regrade` and CLAUDE.md "Server-side C
 * executor") — not for a student's live "実行"/final submit, which still runs
 * in-browser via @wasmer/sdk. `oom` is always reported `false` for C: unlike
 * Java's `-Xmx` there's no reliable signal to grep for, only the coarse
 * `ulimit -v` secondary guard applied at run time (matches the existing "C
 * has no MLE" note in docs/languages.md).
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

  private static final Semaphore RUN_SLOTS = new Semaphore(MAX_CONCURRENT_RUNS, true);
  private static final Path WORK_ROOT = Path.of(System.getenv().getOrDefault("JUDGE_WORK", "/work"));

  private Judge() {}

  public static void main(String[] args) throws IOException {
    Files.createDirectories(WORK_ROOT);
    HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", PORT), 0);
    server.setExecutor(Executors.newFixedThreadPool(Math.max(4, MAX_CONCURRENT_RUNS + 2)));
    server.createContext("/health", ex -> writeJson(ex, 200, "{\"ok\":true}"));
    server.createContext("/run", Judge::handleRun);
    server.start();
    System.out.println("judge listening on :" + PORT
        + " (maxConcurrent=" + MAX_CONCURRENT_RUNS + ")");
  }

  // ---- request / response DTOs (Gson-mapped) --------------------------------

  private static final class RunRequest {
    String language; // "JAVA" (default) or "C"
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

    TestOutcome(String id, String stdout, String stderr, Integer exitCode,
        boolean timedOut, boolean oom) {
      this.id = id;
      this.stdout = stdout;
      this.stderr = stderr;
      this.exitCode = exitCode;
      this.timedOut = timedOut;
      this.oom = oom;
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
    return "C".equalsIgnoreCase(raw.trim()) ? "C" : "JAVA";
  }

  private static RunResponse compileAndRun(RunRequest req) throws IOException, InterruptedException {
    String language = normalizeLanguage(req.language);
    Path jobDir = Files.createTempDirectory(WORK_ROOT, "job-");
    try {
      if ("C".equals(language)) {
        Path srcDir = Files.createDirectories(jobDir.resolve("src"));
        Path mainC = srcDir.resolve("main.c");
        Files.writeString(mainC, req.code);
        Path binary = jobDir.resolve("a.out");

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

  // Subprocess gcc build — plain `-O2 -std=c11`, no student-facing flags to
  // tune. Diagnostics come out as `main.c:LINE:COL: error: ...` (cwd = srcDir,
  // relative filename) which is the same shape @wasmer/sdk's clang produces
  // client-side, so anything that ever parses these (src/lib/compileErrors.ts)
  // doesn't need a separate case for the server path.
  private static CompileInfo compileC(Path mainC, Path binary, Path srcDir)
      throws IOException, InterruptedException {
    List<String> cmd = List.of(
        "gcc", "-O2", "-std=c11", "-Wall",
        "-o", binary.toString(),
        mainC.getFileName().toString(),
        "-lm");
    ProcessBuilder pb = new ProcessBuilder(cmd);
    pb.directory(srcDir.toFile());
    pb.environment().clear();
    pb.environment().put("PATH", "/usr/bin:/bin");
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
      return new CompileInfo(false, stderr.isBlank() ? "gcc exited with status " + process.exitValue() : stderr);
    }
    // Unlike javac's NOTE-stripping above, any gcc -Wall output on a
    // successful build is genuinely about the student's own code.
    return new CompileInfo(true, stderr.trim());
  }

  private static TestOutcome runOne(Path jobDir, String language, Path artifact, TestSpec test)
      throws IOException, InterruptedException {
    long timeLimitMs = clamp(test.timeLimitMs, DEFAULT_TIME_LIMIT_MS, MAX_TIME_LIMIT_MS);
    long memLimitMb = clamp(test.memoryLimitMb, DEFAULT_MEM_LIMIT_MB, MAX_MEM_LIMIT_MB);
    long cpuSeconds = (timeLimitMs / 1000) + 2;
    String stdin = test.stdin != null ? test.stdin : "";
    boolean isC = "C".equals(language);

    // ulimit gives cheap secondary guards (file size, CPU seconds, and for C
    // also address space) on top of the wall-clock kill below; `exec`
    // replaces the shell so the timeout targets the program directly. Only
    // POSIX-portable options are used (the container's /bin/sh is dash — no
    // `ulimit -u`); fork bombs are contained by the container-level
    // pids_limit instead.
    String shell = isC
        ? "ulimit -f 32768; ulimit -t " + cpuSeconds + "; ulimit -v " + (memLimitMb * 1024) + "; exec \"$@\""
        : "ulimit -f 32768; ulimit -t " + cpuSeconds + "; exec \"$@\"";
    List<String> cmd = isC
        ? List.of("/bin/sh", "-c", shell, "sh", artifact.toString())
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

    boolean exited = process.waitFor(timeLimitMs + 500, TimeUnit.MILLISECONDS);
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
    // C: no reliable OOM signal to grep (see the class-level doc comment) —
    // always report false rather than guess. Java: -Xmx makes this precise.
    boolean oom = !isC
        && (stderr.contains("OutOfMemoryError") || stderr.contains("java.lang.OutOfMemoryError"));

    return new TestOutcome(test.id, stdout, stderr, exitCode, timedOut, oom);
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
    private final ByteArrayOutputStream buf = new ByteArrayOutputStream();
    private volatile boolean truncated = false;

    StreamDrainer(InputStream in) {
      this.in = in;
      setDaemon(true);
    }

    @Override
    public void run() {
      byte[] chunk = new byte[8192];
      int n;
      try {
        while ((n = in.read(chunk)) != -1) {
          int room = MAX_STREAM_BYTES - buf.size();
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
