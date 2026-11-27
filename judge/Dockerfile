# Sandboxed compile/run service for every answer language. The container
# itself is the sandbox boundary — see docker-compose.yml for the hardening
# flags (cap_drop, read_only, tmpfs, pids_limit, mem_limit, no outbound
# network). Nothing here runs on the host.
#
# Runtimes (2026-09-26): Java (JDK 24, --enable-preview) as before, plus the
# same runtimes the browser uses for the C / JS / TS / Python preview, so the
# server-side grading can't disagree with it:
#   - clang 16 → wasm32-wasi + wasi-libc, run under Node's WASI (C)
#   - Node 22 + runner/ (JS / TS via the shared harness + sucrase, Python via
#     the pinned Pyodide npm package)

# Node binary (copied into the final image) + the runner's npm dependencies.
FROM node:22-bookworm-slim AS runner
WORKDIR /runner
COPY runner/package.json runner/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY runner/ ./
# Pyodide memory snapshot of a freshly booted interpreter (see
# runner/makeSnapshot.mjs): each Python submission restores it in ~50ms
# instead of booting Pyodide (~1.1s) — the main grading-throughput win.
RUN node makeSnapshot.mjs

FROM eclipse-temurin:24-jdk

# clang 16 + lld (wasm-ld) + wasi-libc (sysroot) + the wasm32 compiler-rt
# builtins: the browser's @wasmer/sdk clang is 16.0.0, so this matches its
# major version and target.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
         clang-16 lld-16 wasi-libc libclang-rt-16-dev-wasm32 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=runner /usr/local/bin/node /usr/local/bin/node
COPY --from=runner /runner /app/runner

WORKDIR /app

COPY Judge.java /app/src/Judge.java
RUN javac -d /app/classes /app/src/Judge.java \
    && chmod -R a+rX /app

# Unprivileged runtime user (the base image already uses uid 1000); /work is a
# tmpfs mount supplied by compose.
RUN groupadd --gid 1010 judge \
    && useradd --uid 1010 --gid 1010 --create-home --home-dir /home/judge judge \
    && mkdir -p /work && chown judge:judge /work
USER judge

ENV JUDGE_PORT=8080 \
    JUDGE_WORK=/work \
    JUDGE_MAX_CONCURRENT=2

EXPOSE 8080

# No external JAR dependencies; the service itself is tiny.
CMD ["java", "-XX:+UseSerialGC", "-Xmx256m", "-cp", "/app/classes", "Judge"]
