# Sandboxed Java + C compile/run service. The container itself is the sandbox
# boundary — see docker-compose.yml for the hardening flags (cap_drop,
# read_only, tmpfs, pids_limit, mem_limit, no outbound network). Nothing here
# runs on the host.
FROM eclipse-temurin:24-jdk

ARG GSON_VERSION=2.11.0
ARG GSON_SHA256=57928d6e5a6edeb2abd3770a8f95ba44dce45f3b23b7a9dc2b309c581552a78b

# gcc for the C executor (used only for teacher-triggered regrade today — see
# CLAUDE.md "Server-side C executor"). libc6-dev supplies the headers/static
# bits gcc needs to link a normal C program.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libc6-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Gson (JSON (de)serialization for the /run protocol). Fetched at build time
# only; the running container needs no network for its own operation.
ADD https://repo1.maven.org/maven2/com/google/code/gson/gson/${GSON_VERSION}/gson-${GSON_VERSION}.jar /app/lib/gson.jar
RUN echo "${GSON_SHA256}  /app/lib/gson.jar" | sha256sum -c -

COPY Judge.java /app/src/Judge.java
RUN javac -cp /app/lib/gson.jar -d /app/classes /app/src/Judge.java \
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

# JSON on the classpath for the app; -Xss for deep student recursion during
# compile; the service itself is tiny.
CMD ["java", "-XX:+UseSerialGC", "-Xmx256m", "-cp", "/app/classes:/app/lib/gson.jar", "Judge"]
