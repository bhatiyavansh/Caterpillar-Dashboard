// Transpile a set of TypeScript files to ESM (.mjs) so Node can run them without a bundler.
// Relative imports get an explicit .mjs extension; type-only imports are erased by TypeScript.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export function transpileTree(files, srcRoot, outRoot) {
  fs.mkdirSync(outRoot, { recursive: true });
  for (const file of files) {
    const rel = path.relative(srcRoot, file).replace(/\.tsx?$/, ".mjs");
    const out = path.join(outRoot, rel);
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        verbatimModuleSyntax: false,
      },
      fileName: file,
    }).outputText;
    const fixed = code.replace(/(from\s+|import\s*\(\s*|import\s+)(["'])(\.{1,2}\/[^"']+)\2/g, (m, pre, q, spec) =>
      /\.(mjs|js|json)$/.test(spec) ? m : `${pre}${q}${spec}.mjs${q}`,
    );
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, fixed);
  }
}
