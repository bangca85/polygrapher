import { GoExtractor } from './src/extractors/go-extractor';
import { createParser, parseSource } from './src/parser/tree-sitter-engine';
import { Language } from './src/types/graph.types';
import fs from 'fs';
import path from 'path';

async function main() {
  const parser = await createParser(Language.Go);
  const extractor = new GoExtractor(parser);
  
  const FIXTURES = '/Users/bangca/bangca/personal/polygrapher/test-fixtures/go';
  const files = [
    path.join(FIXTURES, 'kratos-grpc/main.go')
  ];

  for (const file of files) {
    console.log(`\n\n=== PARSING ${file} ===`);
    const content = fs.readFileSync(file, 'utf8');
    const tree = parseSource(parser, content);
    
    const calls = tree.rootNode.descendantsOfType('call_expression');
    for (const callNode of calls) {
        // @ts-ignore
        const route = extractor.extractRouteRegistration(callNode, file, new Map());
        if (route) {
            console.log("MATCHED ROUTE:", route);
        } else {
            const funcRef = callNode.childForFieldName('function');
            const op = funcRef?.childForFieldName('operand')?.text;
            const field = funcRef?.childForFieldName('field')?.text;
            if (op && field) {
                console.log(`NO MATCH: ${op}.${field}()`);
            }
        }
    }
  }
}

main().catch(console.error);
