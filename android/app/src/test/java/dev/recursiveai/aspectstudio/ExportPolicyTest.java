package dev.recursiveai.aspectstudio;

import static org.junit.Assert.*;
import java.util.Random;
import org.junit.Test;

public class ExportPolicyTest {
    @Test public void filenamesRejectTraversalAndControlCharacters() {
        ExportPolicy.validateFilename("Library 2026.aspects.json");
        ExportPolicy.validateFilename("人物.aspect");
        for (String invalid : new String[] {"", ".", "..", "../secret", "dir/file", "dir\\file", "x\nfile", "x\u0000file", "x".repeat(181)}) {
            assertThrows(IllegalArgumentException.class, () -> ExportPolicy.validateFilename(invalid));
        }
        assertThrows(IllegalArgumentException.class, () -> ExportPolicy.validateFilename(null));
    }

    @Test public void contentTypesAndTokensAreValidated() {
        for (String mime : new String[] {"application/json", "application/zip", "text/html", "application/octet-stream"}) ExportPolicy.validateMimeType(mime);
        assertThrows(IllegalArgumentException.class, () -> ExportPolicy.validateMimeType("image/svg+xml"));
        assertThrows(IllegalArgumentException.class, () -> ExportPolicy.validateMimeType(null));
        ExportPolicy.validateToken("12345678-1234-1234-1234-123456789abc");
        for (String token : new String[] {"../../secret", "12345678-1234-1234-1234-123456789ab/", "", "A".repeat(36)}) {
            assertThrows(IllegalArgumentException.class, () -> ExportPolicy.validateToken(token));
        }
    }

    @Test public void chunkSizesMatchActualBase64ForSeededInputs() {
        Random random = new Random(0x415350454354L);
        for (int size : new int[] {0, 1, 2, 3, 4, 192 * 1024, ExportPolicy.MAX_CHUNK_BYTES}) {
            byte[] data = new byte[size];
            random.nextBytes(data);
            assertEquals(size, ExportPolicy.decodedSize(java.util.Base64.getEncoder().encodeToString(data)));
        }
        for (String invalid : new String[] {"A", "AA", "AAA", "====", "AA=A", "A===", "a b=", "éé==", "AA\n="}) {
            assertThrows(invalid, IllegalArgumentException.class, () -> ExportPolicy.decodedSize(invalid));
        }
        String huge = java.util.Base64.getEncoder().encodeToString(new byte[ExportPolicy.MAX_CHUNK_BYTES + 1]);
        assertThrows(IllegalArgumentException.class, () -> ExportPolicy.decodedSize(huge));
    }

    @Test public void totalLimitsCannotOverflow() {
        ExportPolicy.validateTotal(0, 0);
        ExportPolicy.validateTotal(ExportPolicy.MAX_BYTES - 1, 1);
        ExportPolicy.validateTotal(ExportPolicy.MAX_BYTES, 0);
        for (long current : new long[] {-1, ExportPolicy.MAX_BYTES, Long.MAX_VALUE}) {
            assertThrows(IllegalArgumentException.class, () -> ExportPolicy.validateTotal(current, 1));
        }
        assertThrows(IllegalArgumentException.class, () -> ExportPolicy.validateTotal(0, -1));
    }
}
