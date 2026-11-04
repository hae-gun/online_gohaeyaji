package com.gohaeyaji.realtime.track;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.zip.GZIPOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;

/**
 * The event log on disk: one file per day (Korean time), one JSON object per line
 * ({dir}/2026-11-04.jsonl). This is the full record to analyse (Redis only keeps counts).
 * Days before today are gzipped (about a tenth of the size, DuckDB reads them as they
 * are), files older than keepDays are deleted, and nothing is written while the disk has less
 * than minFreeBytes left, so statistics can never fill the disk the service runs on.
 *
 * Read with DuckDB: scripts/analytics. Plain Java, no Spring, so it can be checked on its own.
 */
public final class TrackLog {

    private final Path dir;
    private final int keepDays;
    private final long minFreeBytes;
    private String openDate;
    private BufferedWriter out;
    private long spaceCheckedAt;
    private boolean diskLow;

    /** @param dir null or blank: no file log (counting in Redis only) */
    public TrackLog(String dir, int keepDays) {
        this(dir, keepDays, 0);
    }

    public TrackLog(String dir, int keepDays, long minFreeBytes) {
        this.dir = dir == null || dir.isBlank() ? null : Path.of(dir);
        this.keepDays = keepDays;
        this.minFreeBytes = minFreeBytes;
    }

    /** True while writing is paused because the disk is nearly full. */
    public synchronized boolean diskLow() {
        return diskLow;
    }

    public boolean enabled() {
        return dir != null;
    }

    /**
     * Appends lines to the day's file. Called from many threads; one writer at a time.
     * @return false when nothing was written (no file log, or the disk is nearly full)
     */
    public synchronized boolean append(String date, List<String> lines) throws IOException {
        if (dir == null || lines.isEmpty()) {
            return false;
        }
        long now = System.currentTimeMillis();
        if (minFreeBytes > 0 && now - spaceCheckedAt > 60_000) {
            spaceCheckedAt = now;
            Files.createDirectories(dir);
            diskLow = Files.getFileStore(dir).getUsableSpace() < minFreeBytes;
        }
        if (diskLow) {
            return false;
        }
        if (out == null || !date.equals(openDate)) {
            closeQuietly();
            Files.createDirectories(dir);
            out = Files.newBufferedWriter(dir.resolve(date + ".jsonl"), StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            openDate = date;
        }
        for (String l : lines) {
            out.write(l);
            out.write('\n');
        }
        out.flush();
        return true;
    }

    /** Gzips the day files before today ({date}.jsonl -> {date}.jsonl.gz). @return how many */
    public synchronized int compressOld(LocalDate today) throws IOException {
        if (dir == null || !Files.isDirectory(dir)) {
            return 0;
        }
        int n = 0;
        try (DirectoryStream<Path> files = Files.newDirectoryStream(dir, "*.jsonl")) {
            for (Path f : files) {
                LocalDate d = dateOf(f.getFileName().toString());
                if (d == null || !d.isBefore(today)) {
                    continue;
                }
                if (f.getFileName().toString().equals(openDate + ".jsonl")) {
                    closeQuietly();
                }
                Path gz = f.resolveSibling(f.getFileName() + ".gz");
                Path tmp = f.resolveSibling(f.getFileName() + ".gz.tmp");
                try (InputStream in = Files.newInputStream(f); OutputStream o = new GZIPOutputStream(Files.newOutputStream(tmp))) {
                    in.transferTo(o);
                }
                Files.move(tmp, gz, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                Files.delete(f);
                n++;
            }
        }
        return n;
    }

    /** 2026-11-04 from "2026-11-04.jsonl" or "2026-11-04.jsonl.gz", else null. */
    static LocalDate dateOf(String name) {
        int dot = name.indexOf('.');
        if (dot != 10 || !(name.endsWith(".jsonl") || name.endsWith(".jsonl.gz"))) {
            return null;
        }
        try {
            return LocalDate.parse(name.substring(0, dot));
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    /** Deletes day files older than keepDays before today. @return how many were deleted */
    public synchronized int deleteOld(LocalDate today) throws IOException {
        if (dir == null || !Files.isDirectory(dir)) {
            return 0;
        }
        LocalDate oldest = today.minusDays(keepDays);
        int n = 0;
        try (DirectoryStream<Path> files = Files.newDirectoryStream(dir, "*.{jsonl,jsonl.gz}")) {
            for (Path f : files) {
                String name = f.getFileName().toString();
                LocalDate d = dateOf(name);
                if (d == null) {
                    continue;   // not one of ours
                }
                if (d.isBefore(oldest)) {
                    if (name.equals(openDate + ".jsonl")) {
                        closeQuietly();
                    }
                    Files.deleteIfExists(f);
                    n++;
                }
            }
        }
        return n;
    }

    public synchronized void close() {
        closeQuietly();
    }

    private void closeQuietly() {
        if (out != null) {
            try {
                out.close();
            } catch (IOException ignored) {
                // closing a log file that failed: nothing more to do
            }
        }
        out = null;
        openDate = null;
    }
}
