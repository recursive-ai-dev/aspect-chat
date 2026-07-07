const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

/**
 * High-quality image upscaler using Lanczos3 resampling + unsharp masking
 * Usage: node upscaler.js input.jpg output.jpg [scale]
 */
async function upscaleImage(inputPath, outputPath, scale = 2) {
  if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  try {
    const image = sharp(inputPath);
    const metadata = await image.metadata();
    
    const newWidth = Math.round(metadata.width * scale);
    const newHeight = Math.round(metadata.height * scale);

    await image
      .resize(newWidth, newHeight, {
        kernel: sharp.kernel.lanczos3,  // Best quality mathematical upscaling
        fit: 'fill'
      })
      // Unsharp mask to restore edge acutance lost during resize
      .sharpen({
        sigma: 1.2,
        m1: 1.5,    // Flat areas
        m2: 2.5     // Jagged edges
      })
      // Remove JPEG artifacts subtly
      .median(1)
      .jpeg({
        quality: 92,
        progressive: true,
        mozjpeg: true,
        chromaSubsampling: '4:4:4'  // Preserve color detail
      })
      .toFile(outputPath);

    const inputStats = fs.statSync(inputPath);
    const outputStats = fs.statSync(outputPath);

    console.log('\n✓ Upscale complete');
    console.log(`  Input:  ${metadata.width}x${metadata.height} (${(inputStats.size/1024).toFixed(1)} KB)`);
    console.log(`  Output: ${newWidth}x${newHeight} (${(outputStats.size/1024).toFixed(1)} KB)`);
    console.log(`  Scale:  ${scale}x`);

  } catch (err) {
    console.error('Error:', err.message);
  }
}

// CLI arguments
const [,, input, output, scale] = process.argv;
if (!input) {
  console.log('Usage: node upscaler.js <input.jpg> <output.jpg> [scale]');
  console.log('Example: node upscaler.js photo.jpg photo_2x.jpg 2');
  process.exit(0);
}

upscaleImage(input, output || 'output.jpg', parseFloat(scale) || 2);