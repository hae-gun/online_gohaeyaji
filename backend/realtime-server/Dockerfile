# syntax=docker/dockerfile:1.7
# Realtime server image.
#   docker compose up --build                              (from backend/, with Redis)
#   docker build -t gohaeyaji-realtime backend/realtime-server
# The image is built for the machine's CPU. An Apple Silicon Mac builds arm64, which runs as is
# on AWS Graviton (t4g). For an x86 instance (t3): docker buildx build --platform linux/amd64 ...

# ---- build: compile the boot jar, then split it into layers
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY gradlew settings.gradle build.gradle ./
COPY gradle gradle
# Gradle's downloads stay in a BuildKit cache between builds, so a code change does not fetch
# the dependencies again
RUN --mount=type=cache,target=/root/.gradle \
    chmod +x gradlew && ./gradlew --no-daemon dependencies > /dev/null
COPY src/main src/main
RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon bootJar -x test \
 && cp build/libs/*.jar app.jar \
 && java -Djarmode=tools -jar app.jar extract --layers --launcher --destination extracted \
 && mkdir -p extracted/dependencies extracted/spring-boot-loader extracted/snapshot-dependencies extracted/application

# ---- run: JRE only, layers from least to most often changed. A code change replaces only the
# last layer (our classes, a few hundred KB), so pushing and pulling a new version is quick.
FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 10001 app \
 # usage event files (TRACK_DIR); a named volume mounted here starts out owned by app
 && mkdir -p /data/track && chown app /data/track
COPY --from=build /app/extracted/dependencies/ ./
COPY --from=build /app/extracted/spring-boot-loader/ ./
COPY --from=build /app/extracted/snapshot-dependencies/ ./
COPY --from=build /app/extracted/application/ ./
USER app
ENV TZ=Asia/Seoul
EXPOSE 8080
# healthy when Spring and Redis are up (/actuator/health). Plain bash, the image has no curl.
HEALTHCHECK --interval=15s --timeout=3s --start-period=40s --retries=3 \
  CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/8080 && printf 'GET /actuator/health HTTP/1.0\\r\\nHost: localhost\\r\\n\\r\\n' >&3 && grep -q '\"status\":\"UP\"' <&3"]
# the heap may use most of the container's memory limit; on running out of memory, exit so
# Docker restarts the container instead of leaving it half alive. SIGTERM (docker stop) lets
# the graceful shutdown in application.yml close the WebSocket sessions first.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-XX:+ExitOnOutOfMemoryError", "org.springframework.boot.loader.launch.JarLauncher"]
