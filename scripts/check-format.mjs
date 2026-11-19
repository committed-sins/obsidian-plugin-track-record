import ts from 'typescript';
import { readdir, readFile } from 'node:fs/promises';

let failures = 0;
for (const dir of ['src', 'tests', 'scripts']) {
    for (const name of await readdir(dir)) {
        if (!/\.(ts|mjs)$/.test(name)) continue;
        const path = `${dir}/${name}`;
        const text = await readFile(path, 'utf8');
        const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, name.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
        function visit(node)
        {
            const body = ts.isFunctionLike(node) && node.body && ts.isBlock(node.body) ? node.body : undefined;
            const brace = body ?? ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) ? node.getChildren(source).find(child => child.kind === ts.SyntaxKind.OpenBraceToken) : undefined);
            if (brace) {
                const start = brace.getStart(source);
                let previous = start - 1;
                while (previous >= 0 && /\s/.test(text[previous])) previous--;
                if (source.getLineAndCharacterOfPosition(start).line === source.getLineAndCharacterOfPosition(previous).line) {
                    console.error(`${path}:${source.getLineAndCharacterOfPosition(start).line + 1}: expected Allman brace.`);
                    failures++;
                }
            }
            ts.forEachChild(node, visit);
        }
        visit(source);
    }
}
if (failures) process.exitCode = 1;
else console.log('Allman formatting checks passed.');
