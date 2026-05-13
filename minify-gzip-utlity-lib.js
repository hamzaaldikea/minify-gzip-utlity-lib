/**
 * Utilities for comparing JSON payload size across minification, gzip
 * compression, and decompression steps.
 *
 * Running this file directly reads the bundled JSON sample, prints the
 * original size, shows how much minify+gzip reduces the payload, and confirms
 * the payload can still be recovered after decompression.
 *
 * This is a buffered showcase utility. It uses zlib's async gzip/gunzip APIs
 * to avoid blocking the event loop, but it still materializes full payloads in
 * memory because the demo compares complete payload sizes and returns complete
 * payloads.
 *
 * Note: no manual decompression step is needed when fetching gzipped JSON with
 * gaxios, because gaxios returns the decompressed response body when the
 * response has a gzip content-encoding. The manual decompression helper is only
 * needed when you already have a gzipped buffer and want to inflate it without
 * going through gaxios.
 *
 * For gaxios to automatically decompress the response, the server needs to send
 * headers like:
 * {
 *       'content-type': 'application/json; charset=utf-8',
 *       'content-encoding': 'gzip',
 *       'content-length': gzippedBuffer.length,
 * }
 *
 * @author Hamza Al Darawsheh
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { promisify } = require('util');
const zlib = require('zlib');
const { request } = require('gaxios');

// Use async zlib operations so compression work does not block the event loop.
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Format a byte count for readable console output.
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  return `${bytes.toLocaleString()} bytes`;
}

/**
 * Calculate how much smaller a processed payload is compared with the original.
 *
 * @param {number} originalBytes
 * @param {number} currentBytes
 * @returns {string}
 */
function formatReduction(originalBytes, currentBytes) {
  const reductionPercentage =
    ((originalBytes - currentBytes) / originalBytes) * 100;
  return `${reductionPercentage.toFixed(2)}% reduction`;
}

/**
 * Read a file and print its original size.
 *
 * @param {string} filePath
 */
function printFileSize(filePath) {
  const absolutePath = path.resolve(filePath);
  const fileBuffer = fs.readFileSync(absolutePath);

  console.log(`Original file: ${absolutePath}`);
  console.log(`Original size: ${formatBytes(fileBuffer.length)}`);
}

/**
 * Compress a JSON string, optionally minifying it first.
 *
 * When `minify` is enabled, the function parses the JSON and serializes it
 * back without whitespace before producing the gzipped buffer. This helper is
 * intentionally buffered: it returns both the processed JSON string and the
 * gzipped buffer so callers can compare sizes or return the full payload.
 *
 * @param {string} jsonText
 * @param {{minify?: boolean}} [options]
 * @returns {Promise<{json: string, gzippedBuffer: Buffer}>}
 */
async function compressJson(jsonText, { minify = false } = {}) {
  const processedJson = minify
    ? JSON.stringify(JSON.parse(jsonText))
    : jsonText;

  return {
    json: processedJson,
    gzippedBuffer: await gzip(processedJson),
  };
}

/**
 * Print size comparisons for minified JSON, gzipped minified JSON, and the
 * decompressed result. Also prints the first restored object to show the data
 * is still accessible after the round trip.
 *
 * This is part of the demo path and intentionally reads the entire file into
 * memory so the utility can compare complete payload sizes.
 *
 * @param {string} filePath
 * @returns {Promise<void>}
 */
async function printMinifiedAndGzippedSize(filePath) {
  const absolutePath = path.resolve(filePath);
  const fileContents = fs.readFileSync(absolutePath, 'utf8');
  const originalTextSize = Buffer.byteLength(fileContents);
  const minifiedCompressed = await compressJson(fileContents, { minify: true });
  const decompressedMinifiedJson = await decompressMinifiedGzipJson(
    minifiedCompressed.gzippedBuffer,
  );
  const decompressedData = JSON.parse(decompressedMinifiedJson);
  console.log(
    `Size after minify: ${formatBytes(Buffer.byteLength(minifiedCompressed.json))} (${formatReduction(originalTextSize, Buffer.byteLength(minifiedCompressed.json))})`,
  );
  console.log(
    `Size after gzip the minified version: ${formatBytes(minifiedCompressed.gzippedBuffer.length)} (${formatReduction(originalTextSize, minifiedCompressed.gzippedBuffer.length)})`,
  );
  console.log(
    `Size after decompressing gzipped minified version: ${formatBytes(Buffer.byteLength(decompressedMinifiedJson))} (${formatReduction(originalTextSize, Buffer.byteLength(decompressedMinifiedJson))}) (there is reduction even after the decompression)`,
  );
  console.log('First object after decompressing:');
  console.log(JSON.stringify(decompressedData[0], null, 2));
}

/**
 * Start a temporary local server that responds with gzipped JSON.
 *
 * This is only used by the demo flow to show how gaxios handles a gzipped JSON
 * HTTP response.
 *
 * @param {Buffer} gzippedBuffer
 * @returns {Promise<{server: import('http').Server, url: string}>}
 */
function startGzipResponseServer(gzippedBuffer) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url !== '/payload') {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }

      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-encoding': 'gzip',
        'content-length': gzippedBuffer.length,
      });
      res.end(gzippedBuffer);
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to start gzip response server.'));
        return;
      }

      resolve({ server, url: `http://127.0.0.1:${address.port}/payload` });
    });
  });
}

/**
 * Fetch a gzipped minified JSON payload with gaxios and print the size of the
 * body returned by the client.
 *
 * This demonstrates that gaxios returns the decompressed response body for a
 * standard JSON request, so no manual gunzip step is needed here. Like the
 * other demo helpers, it reads the full sample payload so it can print complete
 * size comparisons.
 *
 * @param {string} filePath
 * @returns {Promise<void>}
 */
async function printGaxiosReadSize(filePath) {
  const absolutePath = path.resolve(filePath);
  const fileContents = fs.readFileSync(absolutePath, 'utf8');
  const originalTextSize = Buffer.byteLength(fileContents);
  const minifiedCompressed = await compressJson(fileContents, { minify: true });
  const { server, url } = await startGzipResponseServer(
    minifiedCompressed.gzippedBuffer,
  );

  try {
    const response = await request({
      url,
      method: 'GET',
      responseType: 'text',
      headers: {
        'accept-encoding': 'gzip',
      },
    });
    const responseText = response.data;

    console.log(
      `Size after reading gzipped response with gaxios: ${formatBytes(Buffer.byteLength(responseText))} (${formatReduction(originalTextSize, Buffer.byteLength(responseText))}) (gaxios returned the decompressed body, so no manual decompression was needed)`,
    );
    console.log('First object after reading gzipped response with gaxios:');
    console.log(JSON.stringify(JSON.parse(responseText)[0], null, 2));
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

/**
 * Decompress a gzipped minified JSON buffer back into its JSON string form.
 *
 * This reverses gzip compression only. If the original payload was minified
 * before compression, the returned string will still be minified JSON.
 *
 * The helper returns the full JSON string because the current use case expects
 * the complete payload back rather than a streaming reader.
 *
 * @param {Buffer} gzippedMinifiedBuffer
 * @returns {Promise<string>}
 */
async function decompressMinifiedGzipJson(gzippedMinifiedBuffer) {
  return (await gunzip(gzippedMinifiedBuffer)).toString('utf8');
}

if (require.main === module) {
  const defaultFilePath = path.join(
    __dirname,
    'minify-gzip-utlity-lib-sample-data-2mb.json',
  );
  const targetFilePath = process.argv[2] || defaultFilePath;

  (async () => {
    printFileSize(targetFilePath);
    await printMinifiedAndGzippedSize(targetFilePath);
    await printGaxiosReadSize(targetFilePath);
  })().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  compressJson,
  decompressMinifiedGzipJson,
  formatReduction,
  printGaxiosReadSize,
  printFileSize,
  printMinifiedAndGzippedSize,
  startGzipResponseServer,
};
