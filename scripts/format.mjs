import ts from 'typescript';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

for (const dir of ['src', 'tests', 'scripts']) {
    for (const name of await readdir(dir)) {
        if (!/\.(ts|mjs)$/.test(name)) continue;
        const file = path.resolve(dir, name);
        let text = await readFile(file, 'utf8');
        const original = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, name.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
        const expansion = new Set();
        function expand(node)
        {
            if (ts.isFunctionLike(node) && node.body && ts.isBlock(node.body)) {
                const start = node.body.getStart(original), end = node.body.end - 1;
                if (original.getLineAndCharacterOfPosition(start).line === original.getLineAndCharacterOfPosition(end).line) {
                    expansion.add(start + 1);
                    if (node.body.statements.length) expansion.add(end);
                }
            }
            ts.forEachChild(node, expand);
        }
        expand(original);
        for (const position of [...expansion].sort((a, b) => b - a)) text = text.slice(0, position) + '\n' + text.slice(position);
        const host = {
            getScriptFileNames: () => [file], getScriptVersion: () => '1',
            getScriptSnapshot: source => source === file ? ts.ScriptSnapshot.fromString(text) : undefined,
            getCurrentDirectory: () => process.cwd(), getCompilationSettings: () => ({ allowJs: true }),
            getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
            fileExists: ts.sys.fileExists, readFile: ts.sys.readFile
        };
        const service = ts.createLanguageService(host);
        const edits = service.getFormattingEditsForDocument(file, {
            indentSize: 4, tabSize: 4, convertTabsToSpaces: true, newLineCharacter: '\n',
            placeOpenBraceOnNewLineForFunctions: true, placeOpenBraceOnNewLineForControlBlocks: false,
            insertSpaceAfterKeywordsInControlFlowStatements: true,
            insertSpaceAfterSemicolonInForStatements: true,
            insertSpaceAfterCommaDelimiter: true, insertSpaceBeforeAndAfterBinaryOperators: true
        });
        for (const edit of edits.sort((a, b) => b.span.start - a.span.start)) text = text.slice(0, edit.span.start) + edit.newText + text.slice(edit.span.start + edit.span.length);
        service.dispose();
        const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, name.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
        const insertions = [];
        function visit(node)
        {
            const body = ts.isFunctionLike(node) && node.body && ts.isBlock(node.body) ? node.body : undefined;
            const brace = body ?? ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) ? node.getChildren(source).find(child => child.kind === ts.SyntaxKind.OpenBraceToken) : undefined);
            if (brace) {
                const position = brace.getStart(source);
                const line = source.getLineAndCharacterOfPosition(position).line;
                const lineStart = source.getPositionOfLineAndCharacter(line, 0);
                if (text.slice(lineStart, position).trim()) {
                    const indent = /^\s*/.exec(text.slice(lineStart, position))[0];
                    insertions.push({ position, value: '\n' + indent });
                }
            }
            ts.forEachChild(node, visit);
        }
        visit(source);
        for (const insertion of insertions.sort((a, b) => b.position - a.position)) text = text.slice(0, insertion.position) + insertion.value + text.slice(insertion.position);
        await writeFile(file, text.replace(/[ \t]+$/gm, ''));
    }
}
