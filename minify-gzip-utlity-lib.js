/**
 * Utilities for comparing JSON payload size across minification, gzip
 * compression, and decompression steps.
 *
 * Running this file directly reads the JSON sample next to it, prints the
 * original size, shows how much minify+gzip reduces the payload, and confirms
 * the data can still be recovered after decompression.
 * Note: no need to use the manual decompression function when fetching gzipped JSON with gaxios, since gaxios automatically returns the decompressed body when the response has a gzip content-encoding. The manual decompression function is only needed if you have a gzipped buffer that you want to decompress without using gaxios.
 * for gaxios to automatically decompress the response header needs be send the following:
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
const zlib = require('zlib');
const { request } = require('gaxios');

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
 * back without whitespace before producing the gzipped buffer.
 *
 * @param {string} jsonText
 * @param {{minify?: boolean}} [options]
 * @returns {{json: string, gzippedBuffer: Buffer}}
 */
function compressJson(jsonText, { minify = false } = {}) {
  const processedJson = minify
    ? JSON.stringify(JSON.parse(jsonText))
    : jsonText;

  return {
    json: processedJson,
    gzippedBuffer: zlib.gzipSync(processedJson),
  };
}

/**
 * Print size comparisons for minified JSON, gzipped minified JSON, and the
 * decompressed result. Also prints the first restored object to show the data
 * is still accessible after the round trip.
 *
 * @param {string} filePath
 */
function printMinifiedAndGzippedSize(filePath) {
  const absolutePath = path.resolve(filePath);
  const fileContents = fs.readFileSync(absolutePath, 'utf8');
  const originalTextSize = Buffer.byteLength(fileContents);
  const minifiedCompressed = compressJson(fileContents, { minify: true });
  const decompressedMinifiedJson = decompressMinifiedGzipJson(
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
 * standard JSON request, so no manual gunzip step is needed here.
 *
 * @param {string} filePath
 * @returns {Promise<void>}
 */
async function printGaxiosReadSize(filePath) {
  const absolutePath = path.resolve(filePath);
  const fileContents = fs.readFileSync(absolutePath, 'utf8');
  const originalTextSize = Buffer.byteLength(fileContents);
  const minifiedCompressed = compressJson(fileContents, { minify: true });
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
 * @param {Buffer} gzippedMinifiedBuffer
 * @returns {string}
 */
function decompressMinifiedGzipJson(gzippedMinifiedBuffer) {
  return zlib.gunzipSync(gzippedMinifiedBuffer).toString('utf8');
}

if (require.main === module) {
  const defaultFilePath = path.join(
    __dirname,
    'minify-gzip-utlity-lib-sample-data-2mb.json',
  );
  const targetFilePath = process.argv[2] || defaultFilePath;

  (async () => {
    printFileSize(targetFilePath);
    printMinifiedAndGzippedSize(targetFilePath);
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
