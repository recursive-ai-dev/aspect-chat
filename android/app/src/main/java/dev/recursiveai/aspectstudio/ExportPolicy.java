package dev.recursiveai.aspectstudio;

/** Pure validation shared by the bridge and host-side adversarial tests. */
final class ExportPolicy {
    static final long MAX_BYTES = 50L * 1024 * 1024;
    static final int MAX_CHUNK_BYTES = 256 * 1024;

    static void validateFilename(String filename) {
        if (filename == null || filename.isEmpty() || filename.length() > 180 || filename.equals(".") || filename.equals("..")) {
            throw new IllegalArgumentException("Invalid export filename");
        }
        for (int i = 0; i < filename.length(); i++) {
            char c = filename.charAt(i);
            if (c < 32 || c == 127 || c == '/' || c == '\\') throw new IllegalArgumentException("Invalid export filename");
        }
    }

    static void validateMimeType(String mimeType) {
        if (!("application/json".equals(mimeType) || "application/zip".equals(mimeType) ||
              "text/html".equals(mimeType) || "application/octet-stream".equals(mimeType))) {
            throw new IllegalArgumentException("Unsupported export content type");
        }
    }

    static void validateToken(String token) {
        if (token == null || !token.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")) {
            throw new IllegalArgumentException("Invalid export token");
        }
    }

    static int decodedSize(String data) {
        if (data == null || data.length() % 4 != 0 || data.length() > ((MAX_CHUNK_BYTES + 2) / 3) * 4) {
            throw new IllegalArgumentException("Invalid export chunk size");
        }
        int padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
        for (int i = 0; i < data.length() - padding; i++) {
            char c = data.charAt(i);
            if (!(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '+' || c == '/')) {
                throw new IllegalArgumentException("Invalid base64 export data");
            }
        }
        int size = data.length() / 4 * 3 - padding;
        if (size < 0 || size > MAX_CHUNK_BYTES) throw new IllegalArgumentException("Export chunk exceeds limit");
        return size;
    }

    static void validateTotal(long current, int additional) {
        if (current < 0 || additional < 0 || current > MAX_BYTES - additional) {
            throw new IllegalArgumentException("Android exports must be at most 50MB");
        }
    }
}
