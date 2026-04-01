import fs from 'node:fs';
import path from 'node:path';
import { createProgram, validatePath, getVersion } from './cli/commands.js';
import { printError, printInfo, printWarning } from './cli/output.js';
import { detectLanguages } from './scanner/language-detector.js';
import { scanFiles } from './scanner/file-scanner.js';
import { getExtractorsForLanguages } from './extractors/extractor-registry.js';
import { buildGraph } from './graph/graph-builder.js';
import { exportJson } from './exporters/json-exporter.js';
import { exportMarkdown } from './exporters/markdown-exporter.js';
import { exportHtml } from './exporters/html-exporter.js';
import { exportAiContext } from './exporters/ai-context-exporter.js';
import { startServer } from './viewer/server.js';
import { Language } from './types/graph.types.js';
import type { MapMeta } from './types/graph.types.js';
import type { ExtractorResult } from './types/extractor.types.js';

const program = createProgram();

program.action(async (targetPath: string, options: { exportOnly: boolean; port: string; lang?: string }) => {
  try {
    const resolvedPath = validatePath(targetPath);
    printInfo(`Scanning ${resolvedPath}...`);

    // Step 1: Detect languages (or use --lang to force)
    let languages: Language[];

    if (options.lang) {
      const forcedLang = options.lang as Language;
      const validLanguages = Object.values(Language) as string[];
      if (!validLanguages.includes(forcedLang)) {
        printError(`Unsupported language: ${forcedLang}. Supported: ${validLanguages.join(', ')}`);
        process.exit(1);
      }
      printInfo(`Forced language: ${forcedLang}`);
      languages = [forcedLang as Language];
    } else {
      const detection = detectLanguages(resolvedPath);

      if (detection.supported.length === 0) {
        let msg = 'No supported languages detected. Polygrapher currently supports: Go, TypeScript/JavaScript, Dart/Flutter.';
        if (detection.unsupported.length > 0) {
          const unsupportedList = detection.unsupported
            .map(u => `  ${u.file} (${u.language} - not yet supported)`)
            .join('\n');
          msg += `\nFound:\n${unsupportedList}`;
        }
        printError(msg);
        process.exit(1);
      }

      languages = detection.supported;
    }

    printInfo(`Detected languages: ${languages.join(', ')}`);

    // Step 2: Get extractors for detected languages
    const extractors = getExtractorsForLanguages(languages);
    const allResults: ExtractorResult[] = [];
    const activeLanguages: Language[] = [];

    for (const extractor of extractors) {
      // Step 3: Scan files for this language
      const files = scanFiles(resolvedPath, extractor.language);
      printInfo(`Found ${files.length} ${extractor.language} files`);

      if (files.length === 0) continue;

      // Step 4: Parse and extract
      const result = await extractor.parse(files, resolvedPath);
      allResults.push(result);
      activeLanguages.push(extractor.language);

      // Report warnings for per-file errors
      for (const error of result.errors) {
        printWarning(`Skipped ${error.file}: ${error.message}`);
      }

      printInfo(`Extracted ${result.nodes.length} nodes, ${result.edges.length} edges`);
    }

    // Step 5: Build graph — only include languages that actually produced results
    const meta: MapMeta = {
      repo: path.basename(resolvedPath),
      languages: activeLanguages,
      generatedAt: new Date().toISOString(),
      polygrapher: getVersion(),
    };

    const systemMap = buildGraph(allResults, meta);

    // Step 6: Export files into polygrapher/ subfolder
    const outputDir = path.join(resolvedPath, 'polygrapher');
    // M-3 security fix: refuse if output dir is a symlink pointing outside target
    if (fs.existsSync(outputDir) && fs.lstatSync(outputDir).isSymbolicLink()) {
      printError(`Refusing to write to symlink directory: ${outputDir}`);
      process.exit(1);
    }
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const jsonPath = exportJson(systemMap, outputDir);
    const mdPath = exportMarkdown(systemMap, outputDir, resolvedPath);
    const htmlPath = exportHtml(systemMap, outputDir, resolvedPath);
    const aiResult = exportAiContext(systemMap, outputDir, resolvedPath);
    printInfo(`System map generated:`);
    printInfo(`  ${jsonPath}`);
    printInfo(`  ${mdPath}`);
    printInfo(`  ${htmlPath}`);
    printInfo(`  AI context: ${aiResult.paths.length} files (index.md + ${aiResult.paths.length - 1} modules)`);
    for (const warning of aiResult.warnings) {
      printWarning(`Token budget: ${warning}`);
    }

    if (options.exportOnly) {
      // --export-only: files written, no viewer, exit cleanly
      process.exit(0);
    }

    // Default mode: start local server & open browser
    const port = parseInt(options.port, 10) || 3030;
    if (port < 1024 || port > 65535) {
      printError(`Invalid port: ${port}. Must be between 1024 and 65535.`);
      process.exit(1);
    }
    const server = startServer(systemMap, resolvedPath, port, async (url) => {
      printInfo(`\nViewer running at ${url}`);
      printInfo('Press Ctrl+C to stop\n');

      // Auto-open browser
      try {
        const open = await import('open');
        await open.default(url);
      } catch {
        printInfo(`Open ${url} in your browser`);
      }
    });

    // Track connections for forced shutdown
    const connections = new Set<import('node:net').Socket>();
    server.on('connection', (conn) => {
      connections.add(conn);
      conn.on('close', () => connections.delete(conn));
    });

    // Graceful shutdown on Ctrl+C
    const shutdown = () => {
      printInfo('\nShutting down...');
      // Destroy all active connections immediately (browser keep-alive blocks server.close)
      for (const conn of connections) {
        conn.destroy();
      }
      server.close(() => process.exit(0));
      // Force exit after 1s if server.close hangs
      setTimeout(() => process.exit(0), 1000).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (error) {
    if (error instanceof Error) {
      printError(error.message);
    } else {
      printError('An unknown error occurred');
    }
    process.exit(1);
  }
});

program.parse();
